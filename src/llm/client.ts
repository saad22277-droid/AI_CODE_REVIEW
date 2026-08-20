import Anthropic from "@anthropic-ai/sdk";
import { Finding, ReviewChunk } from "../types";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts";
import { LlmReviewOutputSchema, REPORT_FINDINGS_TOOL } from "./schema";

/**
 * Abstraction over "thing that reviews a diff chunk and returns findings."
 * Two implementations: AnthropicReviewer (real) and MockReviewer
 * (deterministic). Everything downstream — the orchestrator, the CLI, the
 * eval harness — depends on this interface, not on the SDK directly. That
 * means the eval harness can validate the merge/scoring pipeline without
 * spending API budget on every run, and unit tests never need a live key.
 */
export interface LLMReviewer {
  reviewChunk(chunk: ReviewChunk, staticFindings: Finding[]): Promise<Finding[]>;
}

export class AnthropicReviewer implements LLMReviewer {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async reviewChunk(chunk: ReviewChunk, staticFindings: Finding[]): Promise<Finding[]> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(chunk, staticFindings) }],
      tools: [REPORT_FINDINGS_TOOL],
      tool_choice: { type: "tool", name: "report_findings" },
    });

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );
    if (!toolUse) return []; // shouldn't happen with tool_choice forced, but never trust that blindly

    const parsed = LlmReviewOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      process.stderr.write(
        `[llm] response for ${chunk.file} failed schema validation, skipping chunk: ${parsed.error.message}\n`
      );
      return [];
    }

    return parsed.data.findings.map((f) => ({
      file: chunk.file,
      line: f.line,
      endLine: f.endLine,
      severity: f.severity,
      category: f.category,
      message: f.message,
      suggestion: f.suggestion,
      source: "llm" as const,
    }));
  }
}

/**
 * Free-tier reviewer using Google's Gemini API. No SDK dependency — Node 22
 * ships a built-in `fetch`, and the REST surface here is small enough that
 * a dependency would add more weight than it saves. Get a key (no credit
 * card required) at https://aistudio.google.com/apikey.
 */
export class GeminiReviewer implements LLMReviewer {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async reviewChunk(chunk: ReviewChunk, staticFindings: Finding[]): Promise<Finding[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserMessage(chunk, staticFindings) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          // Same shape as the Anthropic tool's input_schema — Gemini's
          // responseSchema takes a plain JSON Schema object directly, no
          // outer "tool" wrapper needed.
          responseSchema: REPORT_FINDINGS_TOOL.input_schema,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
    }

    interface GeminiResponse {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return [];

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      process.stderr.write(`[llm] Gemini response for ${chunk.file} wasn't valid JSON, skipping chunk\n`);
      return [];
    }

    const parsed = LlmReviewOutputSchema.safeParse(raw);
    if (!parsed.success) {
      process.stderr.write(
        `[llm] response for ${chunk.file} failed schema validation, skipping chunk: ${parsed.error.message}\n`
      );
      return [];
    }

    return parsed.data.findings.map((f) => ({
      file: chunk.file,
      line: f.line,
      endLine: f.endLine,
      severity: f.severity,
      category: f.category,
      message: f.message,
      suggestion: f.suggestion,
      source: "llm" as const,
    }));
  }
}

/**
 * Deterministic stand-in for the real model, used by the eval harness and
 * unit tests. It is intentionally NAIVE — simple substring/regex checks,
 * nothing resembling actual reasoning about the code. That's the point:
 * it exists to prove the chunking -> review -> merge -> scoring pipeline
 * is wired correctly, not to claim anything about how well an LLM reviews
 * code. See eval/report.md for why its recall is deliberately imperfect.
 */
export class MockReviewer implements LLMReviewer {
  async reviewChunk(chunk: ReviewChunk): Promise<Finding[]> {
    const findings: Finding[] = [];
    const addedLines = chunk.text
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"));

    for (const raw of addedLines) {
      const line = raw.slice(1);
      const lineNumberMatch = extractLineNumber(chunk, raw);
      if (!lineNumberMatch) continue;

      if (/["'`].*(SELECT|INSERT|UPDATE|DELETE).*["'`]\s*\+/i.test(line) || /\+\s*["'`].*(SELECT|INSERT)/i.test(line)) {
        findings.push(mkFinding(chunk.file, lineNumberMatch, "critical", "security",
          "Query built via string concatenation with an external value — looks like a SQL injection risk.",
          "Use a parameterized query / prepared statement instead of concatenating input into SQL."));
      }
      if (/(api[_-]?key|secret|token)\w*\s*=\s*["'][a-zA-Z0-9\-_]{16,}["']/i.test(line)) {
        findings.push(mkFinding(chunk.file, lineNumberMatch, "critical", "security",
          "Hardcoded credential-looking string literal.",
          "Move this to an environment variable or secrets manager."));
      }
      // Deliberately naive over-trigger to exercise the false-positive path
      // in the eval scoring: any line merely containing "password" as a
      // substring gets flagged, even in a harmless variable name.
      if (/password/i.test(line) && !/api[_-]?key|secret/i.test(line)) {
        findings.push(mkFinding(chunk.file, lineNumberMatch, "warning", "security",
          "Line references 'password' — flagging for manual review of credential handling.",
          undefined));
      }
      // NOTE: no off-by-one / loop-boundary detection here at all — a mock
      // built on string patterns has no way to catch that class of bug.
      // That gap is intentional; see case-04 in the eval set.
    }
    return findings;
  }
}

function mkFinding(
  file: string,
  line: number,
  severity: Finding["severity"],
  category: Finding["category"],
  message: string,
  suggestion?: string
): Finding {
  return { file, line, severity, category, message, suggestion, source: "llm" };
}

/** Recovers the new-file line number for a `+` line inside a rendered chunk. */
function extractLineNumber(chunk: ReviewChunk, rawLine: string): number | null {
  const lines = chunk.text.split("\n");
  let newLineNo: number | null = null;
  for (const l of lines) {
    const hunkHeader = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkHeader) {
      newLineNo = parseInt(hunkHeader[1], 10);
      continue;
    }
    if (newLineNo === null) continue;
    if (l === rawLine) return newLineNo;
    if (l.startsWith("+")) newLineNo++;
    else if (l.startsWith(" ")) newLineNo++;
    // "-" lines don't advance the new-file counter
  }
  return null;
}
