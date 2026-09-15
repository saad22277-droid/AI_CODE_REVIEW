"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeFindings = mergeFindings;
exports.shouldFail = shouldFail;
const types_1 = require("../types");
const PROXIMITY_LINES = 2;
function severityAtLeast(f, threshold) {
    return types_1.SEVERITY_RANK[f.severity] >= types_1.SEVERITY_RANK[threshold];
}
/**
 * Same file, nearby line, same category, AND a different source. That last
 * condition matters: two findings from the *same* source sitting close
 * together (two separate LLM observations in one chunk response, or two
 * distinct lint rules firing on adjacent lines) are almost always genuinely
 * different issues, not the same issue reported twice. Only a cross-source
 * pair — a static tool and the LLM, or eslint and semgrep — landing on the
 * same spot is the "two tools caught the same bug" case this is meant to
 * collapse. Without the source check, three unrelated same-category
 * findings a couple of lines apart silently collapse into one (caught by
 * tests/merge.test.ts).
 */
function normalizeFilePath(file) {
    return file.replace(/\\/g, "/");
}
function isDuplicate(a, b) {
    return (normalizeFilePath(a.file) === normalizeFilePath(b.file) &&
        a.category === b.category &&
        a.source !== b.source &&
        Math.abs(a.line - b.line) <= PROXIMITY_LINES);
}
/**
 * Merges findings from ESLint, Semgrep, and the LLM into one ranked list.
 * When two findings look like the same underlying issue, the deterministic
 * source (eslint/semgrep) wins — it's cheaper to trust and typically has a
 * more precise line number — but the LLM's suggestion is attached if the
 * static finding didn't have one, since that's often the more actionable
 * part.
 */
function mergeFindings(all, config) {
    const bySourcePriority = { eslint: 0, semgrep: 0, llm: 1 };
    const sorted = [...all].sort((a, b) => bySourcePriority[a.source] - bySourcePriority[b.source]);
    const kept = [];
    for (const finding of sorted) {
        const dupIndex = kept.findIndex((k) => isDuplicate(k, finding));
        if (dupIndex === -1) {
            kept.push(finding);
        }
        else if (!kept[dupIndex].suggestion && finding.suggestion) {
            kept[dupIndex] = { ...kept[dupIndex], suggestion: finding.suggestion };
        }
    }
    return kept
        .filter((f) => severityAtLeast(f, config.severityThreshold))
        .sort((a, b) => {
        const sev = types_1.SEVERITY_RANK[b.severity] - types_1.SEVERITY_RANK[a.severity];
        if (sev !== 0)
            return sev;
        if (a.file !== b.file)
            return a.file.localeCompare(b.file);
        return a.line - b.line;
    });
}
/** Whether the run should exit non-zero, per config.failOnSeverity. */
function shouldFail(findings, config) {
    if (config.failOnSeverity === "never")
        return false;
    return findings.some((f) => severityAtLeast(f, config.failOnSeverity));
}
