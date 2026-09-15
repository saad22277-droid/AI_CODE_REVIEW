import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { DEFAULT_CONFIG, Finding } from "../src/types";
import { runPipeline } from "../src/pipeline";
import { MockReviewer, AnthropicReviewer, GeminiReviewer, LLMReviewer } from "../src/llm/client";

const CASES_DIR = path.join(__dirname, "cases");
const LINE_TOLERANCE = 2;

interface GroundTruthEntry {
  file: string;
  line: number;
  category: string;
}
interface GroundTruth {
  description: string;
  expected: GroundTruthEntry[];
}

interface CaseResult {
  name: string;
  description: string;
  truePositives: GroundTruthEntry[];
  falseNegatives: GroundTruthEntry[];
  falsePositives: Finding[];
  allFindings: Finding[];
}

function scoreCase(expected: GroundTruthEntry[], produced: Finding[]) {
  const truePositives: GroundTruthEntry[] = [];
  const falseNegatives: GroundTruthEntry[] = [];
  const matchedProduced = new Set<number>();

  for (const exp of expected) {
    const matchIdx = produced.findIndex(
      (f, i) =>
        !matchedProduced.has(i) &&
        f.file.replace(/\\/g, "/") === exp.file.replace(/\\/g, "/") &&
        Math.abs(f.line - exp.line) <= LINE_TOLERANCE
    );
    if (matchIdx === -1) {
      falseNegatives.push(exp);
    } else {
      truePositives.push(exp);
      matchedProduced.add(matchIdx);
    }
  }

  const falsePositives = produced.filter((_, i) => !matchedProduced.has(i));
  return { truePositives, falseNegatives, falsePositives };
}

async function runCase(caseDir: string, reviewer: LLMReviewer): Promise<CaseResult> {
  const name = path.basename(caseDir);
  const diff = fs.readFileSync(path.join(caseDir, "diff.patch"), "utf-8");
  const groundTruth: GroundTruth = JSON.parse(
    fs.readFileSync(path.join(caseDir, "ground-truth.json"), "utf-8")
  );
  const repoRoot = path.join(caseDir, "repo");

  const result = await runPipeline(diff, repoRoot, DEFAULT_CONFIG, reviewer);
  const { truePositives, falseNegatives, falsePositives } = scoreCase(
    groundTruth.expected,
    result.findings
  );

  return {
    name,
    description: groundTruth.description,
    truePositives,
    falseNegatives,
    falsePositives,
    allFindings: result.findings,
  };
}

function aggregate(results: CaseResult[]) {
  const tp = results.reduce((n, r) => n + r.truePositives.length, 0);
  const fn = results.reduce((n, r) => n + r.falseNegatives.length, 0);
  const fp = results.reduce((n, r) => n + r.falsePositives.length, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fn, fp, precision, recall, f1 };
}

function toMarkdown(results: CaseResult[], agg: ReturnType<typeof aggregate>, mode: string): string {
  const lines: string[] = [];
  lines.push(`# Eval report (mode: ${mode})`);
  lines.push("");
  lines.push(
    mode === "mock"
      ? "> Generated with `MockReviewer` — a deliberately naive, pattern-matching stand-in for the LLM. " +
          "This validates that the chunking → review → merge → scoring pipeline is wired correctly. " +
          "It is not a benchmark of live model review quality."
      : `> Generated against the live ${DEFAULT_CONFIG.provider} API.`
  );
  lines.push("");
  lines.push("| Case | Expected | Caught (TP) | Missed (FN) | False alarms (FP) |");
  lines.push("|---|---|---|---|---|");
  for (const r of results) {
    lines.push(
      `| ${r.name} | ${r.truePositives.length + r.falseNegatives.length} | ${r.truePositives.length} | ${r.falseNegatives.length} | ${r.falsePositives.length} |`
    );
  }
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push(`- True positives: **${agg.tp}**`);
  lines.push(`- False negatives (missed bugs): **${agg.fn}**`);
  lines.push(`- False positives (false alarms): **${agg.fp}**`);
  lines.push(`- Precision: **${(agg.precision * 100).toFixed(0)}%**`);
  lines.push(`- Recall: **${(agg.recall * 100).toFixed(0)}%**`);
  lines.push(`- F1: **${(agg.f1 * 100).toFixed(0)}%**`);
  lines.push("");
  lines.push("## Per-case detail");
  for (const r of results) {
    lines.push("");
    lines.push(`### ${r.name}`);
    lines.push(r.description);
    if (r.falseNegatives.length) {
      lines.push("");
      lines.push(
        `Missed: ${r.falseNegatives.map((f) => `\`${f.file}:${f.line}\` (${f.category})`).join(", ")}`
      );
    }
    if (r.falsePositives.length) {
      lines.push("");
      lines.push(
        `False alarms: ${r.falsePositives.map((f) => `\`${f.file}:${f.line}\` — ${f.message}`).join("; ")}`
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  const live = process.argv.includes("--live");
  const mode = live ? "live" : "mock";

  let reviewer: LLMReviewer;
  if (live) {
    if (DEFAULT_CONFIG.provider === "gemini") {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error("--live requires GEMINI_API_KEY (free, no credit card: https://aistudio.google.com/apikey).");
        process.exit(1);
      }
      reviewer = new GeminiReviewer(apiKey, DEFAULT_CONFIG.model);
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        console.error("--live requires ANTHROPIC_API_KEY to be set.");
        process.exit(1);
      }
      reviewer = new AnthropicReviewer(apiKey, DEFAULT_CONFIG.model);
    }
  } else {
    reviewer = new MockReviewer();
  }

  const caseDirs = fs
    .readdirSync(CASES_DIR)
    .map((d) => path.join(CASES_DIR, d))
    .filter((d) => fs.statSync(d).isDirectory());

  const results: CaseResult[] = [];
  for (const dir of caseDirs.sort()) {
    results.push(await runCase(dir, reviewer));
  }

  const agg = aggregate(results);

  console.log(chalk.bold(`\nEval results (${mode} mode)\n`));
  for (const r of results) {
    const ok = r.falseNegatives.length === 0 && r.falsePositives.length === 0;
    console.log(
      `${ok ? chalk.green("✔") : chalk.yellow("●")} ${r.name} — ${r.truePositives.length}/${
        r.truePositives.length + r.falseNegatives.length
      } caught, ${r.falsePositives.length} false alarm(s)`
    );
  }
  console.log(
    chalk.bold(
      `\nPrecision ${(agg.precision * 100).toFixed(0)}% · Recall ${(agg.recall * 100).toFixed(
        0
      )}% · F1 ${(agg.f1 * 100).toFixed(0)}%\n`
    )
  );

  const reportPath = path.join(__dirname, "report.md");
  fs.writeFileSync(reportPath, toMarkdown(results, agg, mode));
  console.log(`Full report written to ${reportPath}`);
}

main();
