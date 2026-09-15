#!/usr/bin/env node
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
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const commander_1 = require("commander");
const loadConfig_1 = require("./config/loadConfig");
const pipeline_1 = require("./pipeline");
const buildReviewer_1 = require("./llm/buildReviewer");
const format_1 = require("./report/format");
const dedupe_1 = require("./merge/dedupe");
function getLocalDiff(opts) {
    if (opts.diff) {
        return fs.readFileSync(opts.diff, "utf-8");
    }
    if (opts.staged) {
        return (0, child_process_1.execFileSync)("git", ["diff", "--cached"], { encoding: "utf-8", maxBuffer: 1024 * 1024 * 50 });
    }
    const base = opts.base ?? "HEAD~1";
    return (0, child_process_1.execFileSync)("git", ["diff", base], { encoding: "utf-8", maxBuffer: 1024 * 1024 * 50 });
}
const program = new commander_1.Command();
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
    const config = (0, loadConfig_1.loadConfig)(opts.config);
    const reviewer = (0, buildReviewer_1.buildReviewer)(config);
    const result = await (0, pipeline_1.runPipeline)(rawDiff, process.cwd(), config, reviewer);
    console.log(opts.format === "json" ? (0, format_1.formatJson)(result.findings) : (0, format_1.formatConsole)(result.findings));
    process.stderr.write(`\n(${result.stats.filesReviewed} files, ${result.stats.chunksReviewed} chunks — ` +
        `${result.stats.eslintFindings} eslint, ${result.stats.semgrepFindings} semgrep, ${result.stats.llmFindings} llm, ` +
        `${result.stats.mergedFindings} after merge)\n`);
    if ((0, dedupe_1.shouldFail)(result.findings, config)) {
        process.exitCode = 1;
    }
});
program.parseAsync(process.argv);
