import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFindings, shouldFail } from "../src/merge/dedupe";
import { AppConfig, DEFAULT_CONFIG, Finding } from "../src/types";

function finding(overrides: Partial<Finding>): Finding {
  return {
    file: "a.js",
    line: 10,
    severity: "warning",
    category: "bug",
    message: "issue",
    source: "llm",
    ...overrides,
  };
}

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

test("mergeFindings dedupes same file/category/nearby-line findings across sources", () => {
  const merged = mergeFindings(
    [
      finding({ source: "semgrep", line: 10, category: "security", severity: "critical" }),
      finding({ source: "llm", line: 11, category: "security", severity: "critical", suggestion: "fix it" }),
    ],
    config()
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "semgrep"); // deterministic source wins
  assert.equal(merged[0].suggestion, "fix it"); // but LLM's suggestion is backfilled
});

test("mergeFindings keeps findings that are far apart or different category", () => {
  const merged = mergeFindings(
    [
      finding({ source: "semgrep", line: 10, category: "security" }),
      finding({ source: "llm", line: 50, category: "security" }), // far away
      finding({ source: "llm", line: 10, category: "bug" }), // same line, different category
    ],
    config()
  );
  assert.equal(merged.length, 3);
});

test("mergeFindings filters below severityThreshold", () => {
  const merged = mergeFindings(
    [finding({ severity: "info" }), finding({ severity: "critical", line: 99 })],
    config({ severityThreshold: "warning" })
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].severity, "critical");
});

test("mergeFindings ranks critical before warning before info", () => {
  const merged = mergeFindings(
    [
      finding({ severity: "info", line: 1 }),
      finding({ severity: "critical", line: 2 }),
      finding({ severity: "warning", line: 3 }),
    ],
    config({ severityThreshold: "info" })
  );
  assert.deepEqual(
    merged.map((f) => f.severity),
    ["critical", "warning", "info"]
  );
});

test("shouldFail respects failOnSeverity, including 'never'", () => {
  const findings = [finding({ severity: "critical" })];
  assert.equal(shouldFail(findings, config({ failOnSeverity: "critical" })), true);
  assert.equal(shouldFail(findings, config({ failOnSeverity: "never" })), false);
  assert.equal(
    shouldFail([finding({ severity: "warning" })], config({ failOnSeverity: "critical" })),
    false
  );
});
