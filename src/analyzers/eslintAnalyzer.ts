import { Finding, Severity, DiffFile } from "../types";
import { changedNewLines } from "../diff/parse";

// ESLint's public types are awkward to depend on across major versions
// (flat config vs. eslintrc), so this analyzer talks to it through a
// narrow `any`-typed surface and never lets a shape mismatch crash the
// pipeline — a lint config problem in the target repo should degrade to
// "no eslint findings," not take down the whole review.
/* eslint-disable @typescript-eslint/no-explicit-any */

const RULE_SEVERITY: Record<string, Severity> = {
  // A handful of rules that indicate real bugs, not just style —
  // everything else defaults to "warning" or "info" below.
  "no-undef": "critical",
  "no-unreachable": "critical",
  "no-dupe-keys": "critical",
  "no-const-assign": "critical",
  "no-unsafe-negation": "warning",
  "no-fallthrough": "warning",
  "eqeqeq": "info",
};

function severityFor(ruleId: string | null, eslintLevel: number): Severity {
  if (ruleId && RULE_SEVERITY[ruleId]) return RULE_SEVERITY[ruleId];
  return eslintLevel === 2 ? "warning" : "info";
}

/**
 * Runs ESLint (Node API) over the changed files using whatever ESLint
 * config already exists in the target repo, then filters findings down to
 * only the lines the diff actually touches — pre-existing issues elsewhere
 * in the file are the target repo's business, not this PR's.
 */
export async function runEslint(
  files: DiffFile[],
  repoRoot: string
): Promise<Finding[]> {
  let ESLintCtor: any;
  try {
    ({ ESLint: ESLintCtor } = require("eslint"));
  } catch {
    return []; // eslint not installed in the target repo — skip silently
  }

  const targets = files
    .filter((f) => !f.isDeleted && /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f.path))
    .map((f) => f.path);
  if (targets.length === 0) return [];

  let eslint: any;
  try {
    eslint = new ESLintCtor({ cwd: repoRoot, errorOnUnmatchedPattern: false });
  } catch {
    return [];
  }

  let results: any[];
  try {
    results = await eslint.lintFiles(targets);
  } catch {
    // No config found, or a target file isn't lintable (e.g. outside
    // the project's `include`) — this is expected on many repos.
    return [];
  }

  const findings: Finding[] = [];
  const changedByFile = new Map(files.map((f) => [f.path, changedNewLines(f)]));

  for (const result of results) {
    const relPath = result.filePath.startsWith(repoRoot)
      ? result.filePath.slice(repoRoot.length).replace(/^\/+/, "")
      : result.filePath;
    const changed = changedByFile.get(relPath);
    for (const msg of result.messages ?? []) {
      if (changed && changed.size > 0 && !changed.has(msg.line)) continue;
      findings.push({
        file: relPath,
        line: msg.line ?? 1,
        severity: severityFor(msg.ruleId, msg.severity),
        category: msg.ruleId?.startsWith("security/") ? "security" : "bug",
        message: msg.message,
        source: "eslint",
        ruleId: msg.ruleId ?? undefined,
      });
    }
  }
  return findings;
}
