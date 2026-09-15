"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReviewer = buildReviewer;
const client_1 = require("./client");
const GEMINI_KEY_HELP = "get a free key (no credit card) at https://aistudio.google.com/apikey";
/**
 * Resolves the configured provider to a real reviewer, falling back to
 * MockReviewer with a clear stderr warning if the relevant API key isn't
 * set. This soft fallback is meant for local/CLI use, where "it quietly
 * reviewed with mock findings" is a reasonable default while you're still
 * setting up a key. The GitHub Action entrypoint (src/index.ts)
 * deliberately does NOT use this helper — it hard-fails instead, because
 * silently posting mock-based "no issues found" reviews on a real PR would
 * be actively misleading.
 */
function buildReviewer(config) {
    if (process.env.MOCK_LLM === "1")
        return new client_1.MockReviewer();
    if (config.provider === "gemini") {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            process.stderr.write(`[llm] No GEMINI_API_KEY set (${GEMINI_KEY_HELP}) — falling back to mock findings.\n`);
            return new client_1.MockReviewer();
        }
        return new client_1.GeminiReviewer(apiKey, config.model);
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        process.stderr.write("[llm] No ANTHROPIC_API_KEY set — falling back to mock findings.\n");
        return new client_1.MockReviewer();
    }
    return new client_1.AnthropicReviewer(apiKey, config.model);
}
