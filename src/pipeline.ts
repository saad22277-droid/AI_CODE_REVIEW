import { AppConfig, Finding } from "./types";
import { parseUnifiedDiff } from "./diff/parse";
import { buildChunks } from "./diff/chunk";
import { runEslint } from "./analyzers/eslintAnalyzer";
import { runSemgrep } from "./analyzers/semgrepAnalyzer";
import { LLMReviewer } from "./llm/client";
import { reviewAllChunks } from "./llm/reviewer";
import { mergeFindings } from "./merge/dedupe";

export interface PipelineResult {
  findings: Finding[];
  stats: {
    filesReviewed: number;
    chunksReviewed: number;
    eslintFindings: number;
    semgrepFindings: number;
    llmFindings: number;
    mergedFindings: number;
  };
}

/**
 * Runs the full hybrid review: static analysis first (cheap, deterministic,
 * runs on every changed file), then the LLM on diff chunks with the static
 * findings as context, then merges everything into one ranked list.
 */
export async function runPipeline(
  rawDiff: string,
  repoRoot: string,
  config: AppConfig,
  reviewer: LLMReviewer
): Promise<PipelineResult> {
  const diff = parseUnifiedDiff(rawDiff);
  const reviewableFiles = diff.files.filter((f) => !f.isDeleted);

  const [eslintFindings, semgrepFindings] = await Promise.all([
    config.enableEslint ? runEslint(reviewableFiles, repoRoot) : Promise.resolve([]),
    config.enableSemgrep
      ? runSemgrep(reviewableFiles, repoRoot, config.semgrepConfig)
      : Promise.resolve([]),
  ]);

  const staticFindings = [...eslintFindings, ...semgrepFindings];
  const staticByFile = new Map<string, Finding[]>();
  for (const f of staticFindings) {
    staticByFile.set(f.file, [...(staticByFile.get(f.file) ?? []), f]);
  }

  const chunks = buildChunks(diff, config.ignorePaths, config.maxDiffCharsPerChunk);
  const llmFindings = await reviewAllChunks(chunks, staticByFile, reviewer, config);

  const merged = mergeFindings(
    [...staticFindings, ...llmFindings].filter((f) => config.categories[f.category]),
    config
  );

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
