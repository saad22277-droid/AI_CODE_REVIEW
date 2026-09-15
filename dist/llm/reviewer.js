"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewAllChunks = reviewAllChunks;
const MAX_CONCURRENT_REQUESTS = 1;
/**
 * Runs every chunk through the LLM reviewer with bounded concurrency (so a
 * large PR doesn't fire 40 simultaneous API calls) and isolates failures
 * per chunk — one malformed response or one timed-out request reduces
 * coverage for that file, it doesn't abort the whole review.
 */
async function reviewAllChunks(chunks, staticFindingsByFile, reviewer, config) {
    if (!config.enableLlm || chunks.length === 0)
        return [];
    const results = [];
    let cursor = 0;
    async function worker() {
        while (cursor < chunks.length) {
            const chunk = chunks[cursor++];
            const staticFindings = staticFindingsByFile.get(chunk.file) ?? [];
            try {
                const findings = await reviewer.reviewChunk(chunk, staticFindings);
                results.push(...findings.filter((f) => config.categories[f.category]));
            }
            catch (err) {
                process.stderr.write(`[llm] review failed for ${chunk.file}:${chunk.startLine}-${chunk.endLine}, skipping chunk: ${err.message}\n`);
            }
        }
    }
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, chunks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}
