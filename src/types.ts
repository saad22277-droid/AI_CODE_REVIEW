/**
 * Core types shared across the whole pipeline:
 * static analyzers (ESLint, Semgrep) and the LLM reviewer both
 * produce `Finding[]`, which the merge stage dedupes and ranks.
 */

export type Severity = "critical" | "warning" | "info";
export type Category =
  | "security"
  | "bug"
  | "performance"
  | "maintainability"
  | "style";
export type FindingSource = "eslint" | "semgrep" | "llm";

export interface Finding {
  file: string;
  /** 1-indexed line number in the NEW version of the file */
  line: number;
  endLine?: number;
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
  source: FindingSource;
  ruleId?: string;
}

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  newLineNumber?: number;
  oldLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: DiffFile[];
}

export interface ReviewChunk {
  file: string;
  /** Rendered diff text for this chunk, ready to hand to the LLM */
  text: string;
  /** Line range this chunk covers, for reference/logging */
  startLine: number;
  endLine: number;
}

export interface AppConfig {
  /** Which LLM backend reviews diff chunks. "gemini" has a genuinely free
   *  tier (no credit card) and is the default; "anthropic" is paid but
   *  available if you want it. Static analysis (ESLint/Semgrep) and the
   *  mock reviewer are unaffected by this either way. */
  provider: "gemini" | "anthropic";
  /** Model ID for whichever provider is selected above. */
  model: string;
  maxDiffCharsPerChunk: number;
  severityThreshold: Severity;
  ignorePaths: string[];
  enableEslint: boolean;
  enableSemgrep: boolean;
  /** Passed as `semgrep --config <value>`. Defaults to the bundled offline
   * ruleset (see semgrep-rules/) if left undefined — set to "auto" to use
   * Semgrep's hosted registry instead, if your environment allows the
   * network call to semgrep.dev. */
  semgrepConfig?: string;
  enableLlm: boolean;
  categories: Record<Category, boolean>;
  failOnSeverity: Severity | "never";
}

export const DEFAULT_CONFIG: AppConfig = {
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

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};
