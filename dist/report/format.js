"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatConsole = formatConsole;
exports.formatJson = formatJson;
const chalk_1 = __importDefault(require("chalk"));
const SEVERITY_COLOR = {
    critical: chalk_1.default.red.bold,
    warning: chalk_1.default.yellow.bold,
    info: chalk_1.default.blue.bold,
};
const SEVERITY_ICON = {
    critical: "✖",
    warning: "▲",
    info: "ℹ",
};
function formatConsole(findings) {
    if (findings.length === 0) {
        return chalk_1.default.green("No issues found.");
    }
    const lines = [];
    let currentFile = "";
    for (const f of findings) {
        if (f.file !== currentFile) {
            currentFile = f.file;
            lines.push("");
            lines.push(chalk_1.default.underline(currentFile));
        }
        const color = SEVERITY_COLOR[f.severity];
        const icon = SEVERITY_ICON[f.severity];
        lines.push(`  ${color(`${icon} ${f.severity}`)} ${chalk_1.default.dim(`[${f.source}${f.ruleId ? `/${f.ruleId}` : ""}]`)} line ${f.line}: ${f.message}`);
        if (f.suggestion) {
            lines.push(`    ${chalk_1.default.dim("→")} ${f.suggestion}`);
        }
    }
    const counts = findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {});
    lines.push("");
    lines.push(`${findings.length} finding(s): ${Object.entries(counts)
        .map(([sev, n]) => `${n} ${sev}`)
        .join(", ")}`);
    return lines.join("\n");
}
function formatJson(findings) {
    return JSON.stringify({ findings, count: findings.length }, null, 2);
}
