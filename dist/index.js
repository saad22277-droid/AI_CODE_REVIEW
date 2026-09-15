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
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const loadConfig_1 = require("./config/loadConfig");
const pipeline_1 = require("./pipeline");
const client_1 = require("./llm/client");
const context_1 = require("./github/context");
const postComments_1 = require("./github/postComments");
const dedupe_1 = require("./merge/dedupe");
async function run() {
    try {
        const githubToken = core.getInput("github-token", { required: true });
        const configPath = core.getInput("config-path") || ".aicodereview.yml";
        const config = (0, loadConfig_1.loadConfig)(configPath);
        const providerOverride = core.getInput("provider");
        if (providerOverride === "gemini" || providerOverride === "anthropic") {
            config.provider = providerOverride;
        }
        const modelOverride = core.getInput("model");
        if (modelOverride)
            config.model = modelOverride;
        // Fail loudly rather than silently falling back to mock findings, the
        // way the CLI does for local convenience — posting a mock-based "no
        // issues found" review on a real PR would be actively misleading.
        let reviewer;
        if (config.provider === "gemini") {
            const geminiApiKey = core.getInput("gemini-api-key", { required: true });
            reviewer = new client_1.GeminiReviewer(geminiApiKey, config.model);
        }
        else {
            const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });
            reviewer = new client_1.AnthropicReviewer(anthropicApiKey, config.model);
        }
        const ctx = (0, context_1.getPrContext)(githubToken);
        core.info(`Reviewing PR #${ctx.pullNumber} in ${ctx.owner}/${ctx.repo} with provider=${config.provider}`);
        const rawDiff = await (0, context_1.fetchPrDiff)(ctx);
        const result = await (0, pipeline_1.runPipeline)(rawDiff, process.cwd(), config, reviewer);
        core.info(`${result.stats.filesReviewed} files reviewed, ${result.findings.length} findings after merge ` +
            `(${result.stats.eslintFindings} eslint, ${result.stats.semgrepFindings} semgrep, ${result.stats.llmFindings} llm)`);
        const commitId = github.context.payload.pull_request?.head?.sha;
        if (!commitId)
            throw new Error("Could not determine head commit SHA from the event payload.");
        await (0, postComments_1.postReview)(ctx, result.findings, commitId);
        core.setOutput("findings-count", String(result.findings.length));
        core.setOutput("findings-json", JSON.stringify(result.findings));
        if ((0, dedupe_1.shouldFail)(result.findings, config)) {
            core.setFailed(`Found ${result.findings.filter((f) => f.severity === "critical").length} critical issue(s).`);
        }
    }
    catch (err) {
        core.setFailed(err.message);
    }
}
run();
