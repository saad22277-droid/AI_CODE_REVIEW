import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config/loadConfig";
import { runPipeline } from "./pipeline";
import { AnthropicReviewer, GeminiReviewer, LLMReviewer } from "./llm/client";
import { fetchPrDiff, getPrContext } from "./github/context";
import { postReview } from "./github/postComments";
import { shouldFail } from "./merge/dedupe";

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput("github-token", { required: true });
    const configPath = core.getInput("config-path") || ".aicodereview.yml";

    const config = loadConfig(configPath);
    const providerOverride = core.getInput("provider");
    if (providerOverride === "gemini" || providerOverride === "anthropic") {
      config.provider = providerOverride;
    }
    const modelOverride = core.getInput("model");
    if (modelOverride) config.model = modelOverride;

    // Fail loudly rather than silently falling back to mock findings, the
    // way the CLI does for local convenience — posting a mock-based "no
    // issues found" review on a real PR would be actively misleading.
    let reviewer: LLMReviewer;
    if (config.provider === "gemini") {
      const geminiApiKey = core.getInput("gemini-api-key", { required: true });
      reviewer = new GeminiReviewer(geminiApiKey, config.model);
    } else {
      const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });
      reviewer = new AnthropicReviewer(anthropicApiKey, config.model);
    }

    const ctx = getPrContext(githubToken);
    core.info(`Reviewing PR #${ctx.pullNumber} in ${ctx.owner}/${ctx.repo} with provider=${config.provider}`);

    const rawDiff = await fetchPrDiff(ctx);
    const result = await runPipeline(rawDiff, process.cwd(), config, reviewer);

    core.info(
      `${result.stats.filesReviewed} files reviewed, ${result.findings.length} findings after merge ` +
        `(${result.stats.eslintFindings} eslint, ${result.stats.semgrepFindings} semgrep, ${result.stats.llmFindings} llm)`
    );

    const commitId = github.context.payload.pull_request?.head?.sha;
    if (!commitId) throw new Error("Could not determine head commit SHA from the event payload.");

    await postReview(ctx, result.findings, commitId);

    core.setOutput("findings-count", String(result.findings.length));
    core.setOutput("findings-json", JSON.stringify(result.findings));

    if (shouldFail(result.findings, config)) {
      core.setFailed(
        `Found ${result.findings.filter((f) => f.severity === "critical").length} critical issue(s).`
      );
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

run();
