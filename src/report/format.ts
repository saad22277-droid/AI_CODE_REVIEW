import chalk from "chalk";
import { Finding } from "../types";

const SEVERITY_COLOR: Record<Finding["severity"], (s: string) => string> = {
  critical: chalk.red.bold,
  warning: chalk.yellow.bold,
  info: chalk.blue.bold,
};

const SEVERITY_ICON: Record<Finding["severity"], string> = {
  critical: "✖",
  warning: "▲",
  info: "ℹ",
};

export function formatConsole(findings: Finding[]): string {
  if (findings.length === 0) {
    return chalk.green("No issues found.");
  }

  const lines: string[] = [];
  let currentFile = "";
  for (const f of findings) {
    if (f.file !== currentFile) {
      currentFile = f.file;
      lines.push("");
      lines.push(chalk.underline(currentFile));
    }
    const color = SEVERITY_COLOR[f.severity];
    const icon = SEVERITY_ICON[f.severity];
    lines.push(
      `  ${color(`${icon} ${f.severity}`)} ${chalk.dim(`[${f.source}${f.ruleId ? `/${f.ruleId}` : ""}]`)} line ${f.line}: ${f.message}`
    );
    if (f.suggestion) {
      lines.push(`    ${chalk.dim("→")} ${f.suggestion}`);
    }
  }
  const counts = findings.reduce(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    {} as Record<string, number>
  );
  lines.push("");
  lines.push(
    `${findings.length} finding(s): ${Object.entries(counts)
      .map(([sev, n]) => `${n} ${sev}`)
      .join(", ")}`
  );
  return lines.join("\n");
}

export function formatJson(findings: Finding[]): string {
  return JSON.stringify({ findings, count: findings.length }, null, 2);
}
