#!/usr/bin/env node
import { execFileSync } from "child_process";
import * as fs from "fs";
import { Command } from "commander";
import { loadConfig } from "./config/loadConfig";
import { runPipeline } from "./pipeline";
import { buildReviewer } from "./llm/buildReviewer";
import { formatConsole, formatJson } from "./report/format";
import { shouldFail } from "./merge/dedupe";

function getLocalDiff(opts: { diff?: string; staged?: boolean; base?: string }): string {
  if (opts.diff) {
    return fs.readFileSync(opts.diff, "utf-8");
  }
  if (opts.staged) {
    return execFileSync("git", ["diff", "--cached"], { encoding: "utf-8", maxBuffer: 1024 * 1024 * 50 });
  }
  const base = opts.base ?? "HEAD~1";
  return execFileSync("git", ["diff", base], { encoding: "utf-8", maxBuffer: 1024 * 1024 * 50 });
}

const program = new Command();
program.name("ai-code-review").description("Hybrid AI + static-analysis code review").version("0.1.0");

program
  .command("review", { isDefault: true })
  .description("Review a diff: staged changes, a diff file, or against a base ref")
  .option("--diff <path>", "Path to a unified diff file (e.g. `git diff > changes.diff`)")
  .option("--staged", "Review currently staged changes (git diff --cached)")
  .option("--base <ref>", "Review changes against this git ref (default HEAD~1)")
  .option("--config <path>", "Path to .aicodereview.yml", ".aicodereview.yml")
  .option("--format <format>", "console or json", "console")
  .action(async (opts) => {
    const rawDiff = getLocalDiff(opts);
    if (!rawDiff.trim()) {
      console.log("No changes to review.");
      return;
    }
    const config = loadConfig(opts.config);
    const reviewer = buildReviewer(config);
    const result = await runPipeline(rawDiff, process.cwd(), config, reviewer);

    console.log(
      opts.format === "json" ? formatJson(result.findings) : formatConsole(result.findings)
    );
    process.stderr.write(
      `\n(${result.stats.filesReviewed} files, ${result.stats.chunksReviewed} chunks — ` +
        `${result.stats.eslintFindings} eslint, ${result.stats.semgrepFindings} semgrep, ${result.stats.llmFindings} llm, ` +
        `${result.stats.mergedFindings} after merge)\n`
    );

    if (shouldFail(result.findings, config)) {
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
