import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { Finding, Severity, DiffFile } from "../types";
import { changedNewLines } from "../diff/parse";

const execFileAsync = promisify(execFile);

/**
 * Finds the bundled ruleset by walking up from this file's own location
 * until a `semgrep-rules/` directory turns up, rather than a hardcoded
 * `../..` offset. A fixed offset breaks the moment this file's depth
 * changes between running under ts-node (src/analyzers/) and running
 * compiled (dist/src/analyzers/, dist/analyzers/, or whatever a future
 * tsconfig produces) — walking up is correct under all of them. Resolved
 * relative to this package's own location, NOT the target repo being
 * reviewed (which is `repoRoot`, a completely different directory).
 */
function findBundledRules(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "semgrep-rules", "security.yml");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  // Fall back to the ts-node-relative guess; runSemgrep's own try/catch
  // degrades gracefully to zero findings if this still doesn't resolve.
  return path.join(startDir, "..", "..", "semgrep-rules", "security.yml");
}

const BUNDLED_RULES_PATH = findBundledRules(__dirname);

interface SemgrepResult {
  results: Array<{
    path: string;
    start: { line: number };
    end: { line: number };
    check_id: string;
    extra: {
      message: string;
      severity: string; // "ERROR" | "WARNING" | "INFO"
      metadata?: { category?: string };
    };
  }>;
}

function mapSeverity(s: string): Severity {
  switch (s) {
    case "ERROR":
      return "critical";
    case "WARNING":
      return "warning";
    default:
      return "info";
  }
}

/**
 * Runs `semgrep --config <ruleset> --json` on the changed files. Defaults
 * to a small bundled ruleset (see semgrep-rules/security.yml) covering
 * injection and hardcoded-credential patterns — exactly the class of bug
 * that's fast and cheap to catch deterministically, so the LLM reviewer
 * doesn't have to spend its budget re-deriving pattern matches it can't
 * guarantee. Pass `semgrepConfig: "auto"` in config to use Semgrep's
 * hosted registry instead, if your network allows reaching semgrep.dev —
 * many CI environments (including the one this project was built in)
 * block that by default, which is exactly why the bundled ruleset is the
 * default rather than a hard dependency on registry access.
 *
 * Degrades to an empty result set (with a stderr warning) if the semgrep
 * binary isn't on PATH, rather than failing the whole review — semgrep is
 * an optional layer, not a hard dependency.
 */
export async function runSemgrep(
  files: DiffFile[],
  repoRoot: string,
  semgrepConfig?: string
): Promise<Finding[]> {
  const targets = files.filter((f) => !f.isDeleted).map((f) => f.path);
  if (targets.length === 0) return [];

  const configArg =
    !semgrepConfig || semgrepConfig === "bundled" ? BUNDLED_RULES_PATH : semgrepConfig;

  let stdout: string;
  try {
    const result = await execFileAsync(
      "semgrep",
      ["--config", configArg, "--json", "--quiet", ...targets],
      { cwd: repoRoot, maxBuffer: 1024 * 1024 * 20, timeout: 120_000 }
    );
    stdout = result.stdout;
  } catch (err: any) {
    // semgrep exits non-zero when it finds ERROR-severity results, which
    // execFile treats as a thrown error even though stdout is still valid
    // JSON. Only truly bail if we have no stdout to parse at all.
    if (err?.stdout) {
      stdout = err.stdout;
    } else {
      process.stderr.write(
        `[semgrep] skipped (not installed or failed to run): ${err?.message ?? err}\n`
      );
      return [];
    }
  }

  let parsed: SemgrepResult & { errors?: Array<{ message: string }> };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  if (parsed.errors?.length) {
    process.stderr.write(
      `[semgrep] ${parsed.errors.length} error(s) while scanning (results below may be incomplete):\n` +
        parsed.errors.map((e) => `  - ${e.message}`).join("\n") +
        "\n"
    );
  }

  const changedByFile = new Map(files.map((f) => [f.path, changedNewLines(f)]));
  const findings: Finding[] = [];

  for (const r of parsed.results ?? []) {
    const changed = changedByFile.get(r.path);
    if (changed && changed.size > 0 && !changed.has(r.start.line)) continue;
    findings.push({
      file: r.path,
      line: r.start.line,
      endLine: r.end.line !== r.start.line ? r.end.line : undefined,
      severity: mapSeverity(r.extra.severity),
      category: (r.extra.metadata?.category as any) === "security" ? "security" : "bug",
      message: r.extra.message,
      source: "semgrep",
      ruleId: r.check_id,
    });
  }
  return findings;
}
