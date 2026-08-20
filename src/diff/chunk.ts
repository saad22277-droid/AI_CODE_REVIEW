import { DiffFile, ParsedDiff, ReviewChunk } from "../types";
import { renderFileDiff } from "./parse";

/**
 * Minimal glob matcher supporting `*`, `**`, and literal segments — enough
 * for typical ignore-path patterns without pulling in a dependency.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
      if (glob[i + 1] === "/") i++; // swallow the following slash, ** matches zero+ dirs
    } else if (c === "*") {
      re += "[^/]*";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function isIgnored(path: string, ignorePaths: string[]): boolean {
  return ignorePaths.some((pattern) => globToRegExp(pattern).test(path));
}

/**
 * Splits a parsed diff into review-sized chunks, one or more per file,
 * respecting `maxDiffCharsPerChunk` so a single huge file diff doesn't blow
 * the model's usable context (or the review's cost budget). Files are
 * chunked independently — a hunk is never split mid-hunk, since that would
 * strip the surrounding context the model needs to judge intent.
 */
export function buildChunks(
  diff: ParsedDiff,
  ignorePaths: string[],
  maxCharsPerChunk: number
): ReviewChunk[] {
  const chunks: ReviewChunk[] = [];

  for (const file of diff.files) {
    if (isIgnored(file.path, ignorePaths)) continue;
    if (file.isDeleted) continue; // nothing new to review
    if (file.hunks.length === 0) continue;

    let bucket: DiffFile = { ...file, hunks: [] };
    let bucketChars = 0;

    const flush = () => {
      if (bucket.hunks.length === 0) return;
      const text = renderFileDiff(bucket);
      const first = bucket.hunks[0];
      const last = bucket.hunks[bucket.hunks.length - 1];
      chunks.push({
        file: file.path,
        text,
        startLine: first.newStart,
        endLine: last.newStart + last.newLines,
      });
      bucket = { ...file, hunks: [] };
      bucketChars = 0;
    };

    for (const hunk of file.hunks) {
      const hunkChars = hunk.lines.reduce((n, l) => n + l.content.length + 1, 0);
      if (bucketChars > 0 && bucketChars + hunkChars > maxCharsPerChunk) {
        flush();
      }
      bucket.hunks.push(hunk);
      bucketChars += hunkChars;
      // A single hunk larger than the whole budget still ships alone rather
      // than being dropped — the model will just see less surrounding file
      // context for that one review call.
      if (bucketChars > maxCharsPerChunk) flush();
    }
    flush();
  }

  return chunks;
}
