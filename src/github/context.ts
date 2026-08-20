import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

export interface PrContext {
  owner: string;
  repo: string;
  pullNumber: number;
  octokit: Octokit;
}

export function getPrContext(githubToken: string): PrContext {
  const { context } = github;
  const pullNumber = context.payload.pull_request?.number;
  if (!pullNumber) {
    throw new Error(
      "No pull_request found in the GitHub Actions event payload. This action must run on a pull_request (or pull_request_target) event."
    );
  }
  return {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pullNumber,
    octokit: new Octokit({ auth: githubToken }),
  };
}

/** Fetches the raw unified diff for the PR, ready for parseUnifiedDiff(). */
export async function fetchPrDiff(ctx: PrContext): Promise<string> {
  const response = await ctx.octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber,
    mediaType: { format: "diff" },
  });
  // @octokit/rest types this as an object when format=diff is requested,
  // but at runtime it's the raw diff string — same pattern GitHub's own
  // examples use.
  return response.data as unknown as string;
}
