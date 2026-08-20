import { z } from "zod";

/**
 * Runtime schema for what the model returns. Forcing tool_choice on the
 * API side (see client.ts) makes malformed JSON very unlikely, but "very
 * unlikely" isn't a guarantee worth trusting blindly for a tool that
 * parses its output automatically — this is the belt to that belt-and-
 * suspenders pair, validated again after the SDK deserializes it.
 */
export const LlmFindingSchema = z.object({
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  severity: z.enum(["critical", "warning", "info"]),
  category: z.enum(["security", "bug", "performance", "maintainability", "style"]),
  message: z.string().min(1).max(500),
  suggestion: z.string().max(500).optional(),
});

export const LlmReviewOutputSchema = z.object({
  findings: z.array(LlmFindingSchema),
});

export type LlmReviewOutput = z.infer<typeof LlmReviewOutputSchema>;

/** JSON Schema equivalent, handed to the API as the forced tool's input_schema. */
export const REPORT_FINDINGS_TOOL = {
  name: "report_findings",
  description:
    "Report the code-review findings for this diff chunk. Call this even if there are zero findings (with an empty array) — do not respond with prose.",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: {
              type: "integer",
              description: "1-indexed line number in the NEW file that this finding is about.",
            },
            endLine: {
              type: "integer",
              description: "Optional end line, if the issue spans multiple lines.",
            },
            severity: { type: "string", enum: ["critical", "warning", "info"] },
            category: {
              type: "string",
              enum: ["security", "bug", "performance", "maintainability", "style"],
            },
            message: {
              type: "string",
              description: "One or two sentences explaining the issue, specific to this code.",
            },
            suggestion: {
              type: "string",
              description: "Optional concrete fix, as a short code snippet or instruction.",
            },
          },
          required: ["line", "severity", "category", "message"],
        },
      },
    },
    required: ["findings"],
  },
};
