import { Finding } from "../types";
import { PrContext } from "./context";

const SEVERITY_EMOJI: Record<Finding["severity"], string> = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

function commentBody(f: Finding): string {
  const source = f.source === "llm" ? "AI review" : f.source;
  const lines = [`${SEVERITY_EMOJI[f.severity]} **${f.category}** _(${source})_`, "", f.message];
  if (f.suggestion) {
    lines.push("", `**Suggestion:** ${f.suggestion}`);
  }
  return lines.join("\n");
}

/**
 * Posts findings as a single GitHub PR review with inline comments — one
 * review, many comments, rather than spamming N separate comment
 * notifications. Falls back to a summary-only review (no inline comments)
 * if GitHub rejects a comment position, which happens when a finding
 * lands on a diff line GitHub's review API doesn't consider commentable
 * (e.g. a context line at the very edge of a hunk).
 */
export async function postReview(
  ctx: PrContext,
  findings: Finding[],
  commitId: string
): Promise<void> {
  const summary =
    findings.length === 0
      ? "✅ AI code review found no issues above the configured severity threshold."
      : `Found **${findings.length}** issue(s). See inline comments.`;

  const comments = findings.map((f) => ({
    path: f.file,
    line: f.endLine ?? f.line,
    ...(f.endLine ? { start_line: f.line, start_side: "RIGHT" as const } : {}),
    side: "RIGHT" as const,
    body: commentBody(f),
  }));

  try {
    await ctx.octokit.pulls.createReview({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      commit_id: commitId,
      event: "COMMENT",
      body: summary,
      comments,
    });
  } catch (err) {
    process.stderr.write(
      `[github] inline review failed (likely a stale diff position), falling back to a summary comment: ${
        (err as Error).message
      }\n`
    );
    await ctx.octokit.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.pullNumber,
      body: [summary, "", ...findings.map((f) => `- \`${f.file}:${f.line}\` — ${f.message}`)].join(
        "\n"
      ),
    });
  }
}
