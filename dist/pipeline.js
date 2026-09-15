"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPipeline = runPipeline;
const parse_1 = require("./diff/parse");
const chunk_1 = require("./diff/chunk");
const eslintAnalyzer_1 = require("./analyzers/eslintAnalyzer");
const semgrepAnalyzer_1 = require("./analyzers/semgrepAnalyzer");
const reviewer_1 = require("./llm/reviewer");
const dedupe_1 = require("./merge/dedupe");
/**
 * Runs the full hybrid review: static analysis first (cheap, deterministic,
 * runs on every changed file), then the LLM on diff chunks with the static
 * findings as context, then merges everything into one ranked list.
 */
async function runPipeline(rawDiff, repoRoot, config, reviewer) {
    const diff = (0, parse_1.parseUnifiedDiff)(rawDiff);
    const reviewableFiles = diff.files.filter((f) => !f.isDeleted);
    const [eslintFindings, semgrepFindings] = await Promise.all([
        config.enableEslint ? (0, eslintAnalyzer_1.runEslint)(reviewableFiles, repoRoot) : Promise.resolve([]),
        config.enableSemgrep
            ? (0, semgrepAnalyzer_1.runSemgrep)(reviewableFiles, repoRoot, config.semgrepConfig)
            : Promise.resolve([]),
    ]);
    const staticFindings = [...eslintFindings, ...semgrepFindings];
    const staticByFile = new Map();
    for (const f of staticFindings) {
        staticByFile.set(f.file, [...(staticByFile.get(f.file) ?? []), f]);
    }
    const chunks = (0, chunk_1.buildChunks)(diff, config.ignorePaths, config.maxDiffCharsPerChunk);
    const llmFindings = await (0, reviewer_1.reviewAllChunks)(chunks, staticByFile, reviewer, config);
    const merged = (0, dedupe_1.mergeFindings)([...staticFindings, ...llmFindings].filter((f) => config.categories[f.category]), config);
    return {
        findings: merged,
        stats: {
            filesReviewed: reviewableFiles.length,
            chunksReviewed: chunks.length,
            eslintFindings: eslintFindings.length,
            semgrepFindings: semgrepFindings.length,
            llmFindings: llmFindings.length,
            mergedFindings: merged.length,
        },
    };
}
