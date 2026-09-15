"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSemgrep = runSemgrep;
const child_process_1 = require("child_process");
const util_1 = require("util");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const parse_1 = require("../diff/parse");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
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
function findBundledRules(startDir) {
    let dir = startDir;
    for (let i = 0; i < 8; i++) {
        const candidate = path.join(dir, "semgrep-rules", "security.yml");
        if (fs.existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            break; // reached filesystem root
        dir = parent;
    }
    // Fall back to the ts-node-relative guess; runSemgrep's own try/catch
    // degrades gracefully to zero findings if this still doesn't resolve.
    return path.join(startDir, "..", "..", "semgrep-rules", "security.yml");
}
const BUNDLED_RULES_PATH = findBundledRules(__dirname);
function mapSeverity(s) {
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
async function runSemgrep(files, repoRoot, semgrepConfig) {
    const targets = files.filter((f) => !f.isDeleted).map((f) => f.path);
    if (targets.length === 0)
        return [];
    const configArg = !semgrepConfig || semgrepConfig === "bundled" ? BUNDLED_RULES_PATH : semgrepConfig;
    let stdout;
    try {
        const result = await execFileAsync("semgrep", ["--config", configArg, "--json", "--quiet", ...targets], { cwd: repoRoot, maxBuffer: 1024 * 1024 * 20, timeout: 120_000 });
        stdout = result.stdout;
    }
    catch (err) {
        // semgrep exits non-zero when it finds ERROR-severity results, which
        // execFile treats as a thrown error even though stdout is still valid
        // JSON. Only truly bail if we have no stdout to parse at all.
        if (err?.stdout) {
            stdout = err.stdout;
        }
        else {
            process.stderr.write(`[semgrep] skipped (not installed or failed to run): ${err?.message ?? err}\n`);
            return [];
        }
    }
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    if (parsed.errors?.length) {
        process.stderr.write(`[semgrep] ${parsed.errors.length} error(s) while scanning (results below may be incomplete):\n` +
            parsed.errors.map((e) => `  - ${e.message}`).join("\n") +
            "\n");
    }
    const changedByFile = new Map(files.map((f) => [f.path, (0, parse_1.changedNewLines)(f)]));
    const findings = [];
    for (const r of parsed.results ?? []) {
        const changed = changedByFile.get(r.path);
        if (changed && changed.size > 0 && !changed.has(r.start.line))
            continue;
        findings.push({
            file: r.path,
            line: r.start.line,
            endLine: r.end.line !== r.start.line ? r.end.line : undefined,
            severity: mapSeverity(r.extra.severity),
            category: r.extra.metadata?.category === "security" ? "security" : "bug",
            message: r.extra.message,
            source: "semgrep",
            ruleId: r.check_id,
        });
    }
    return findings;
}
