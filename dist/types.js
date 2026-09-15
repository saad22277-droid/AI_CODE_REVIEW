"use strict";
/**
 * Core types shared across the whole pipeline:
 * static analyzers (ESLint, Semgrep) and the LLM reviewer both
 * produce `Finding[]`, which the merge stage dedupes and ranks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEVERITY_RANK = exports.DEFAULT_CONFIG = void 0;
exports.DEFAULT_CONFIG = {
    provider: "gemini",
    // Google's free-tier Flash model as of Aug 2026 — no credit card needed.
    // Swap provider to "anthropic" + model to e.g. "claude-sonnet-5" for a
    // paid, and possibly higher-accuracy, alternative.
    model: "gemini-3-flash-preview",
    maxDiffCharsPerChunk: 6000,
    severityThreshold: "info",
    ignorePaths: [
        "**/*.lock",
        "**/package-lock.json",
        "**/dist/**",
        "**/node_modules/**",
        "**/*.min.js",
    ],
    enableEslint: true,
    enableSemgrep: true,
    semgrepConfig: "bundled",
    enableLlm: true,
    categories: {
        security: true,
        bug: true,
        performance: true,
        maintainability: true,
        style: false,
    },
    failOnSeverity: "critical",
};
exports.SEVERITY_RANK = {
    critical: 3,
    warning: 2,
    info: 1,
};
