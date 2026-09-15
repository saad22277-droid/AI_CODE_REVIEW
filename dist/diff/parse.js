"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUnifiedDiff = parseUnifiedDiff;
exports.renderFileDiff = renderFileDiff;
exports.changedNewLines = changedNewLines;
const FILE_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
/**
 * Parses unified diff text (the output of `git diff`, or a GitHub PR diff)
 * into structured files/hunks/lines. Deliberately dependency-free: diff
 * format is simple enough that a real parser is more reliable here than an
 * npm package with its own set of quirks.
 */
function parseUnifiedDiff(raw) {
    const lines = raw.split("\n");
    const files = [];
    let current = null;
    let currentHunk = null;
    let oldLineNo = 0;
    let newLineNo = 0;
    const pushHunk = () => {
        if (current && currentHunk) {
            current.hunks.push(currentHunk);
        }
        currentHunk = null;
    };
    const pushFile = () => {
        pushHunk();
        if (current)
            files.push(current);
        current = null;
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fileMatch = line.match(FILE_HEADER_RE);
        if (fileMatch) {
            pushFile();
            current = {
                path: fileMatch[2],
                oldPath: fileMatch[1],
                isNew: false,
                isDeleted: false,
                isRenamed: fileMatch[1] !== fileMatch[2],
                hunks: [],
            };
            continue;
        }
        if (!current)
            continue; // skip preamble before first "diff --git"
        if (line.startsWith("new file mode")) {
            current.isNew = true;
            continue;
        }
        if (line.startsWith("deleted file mode")) {
            current.isDeleted = true;
            continue;
        }
        if (line.startsWith("--- ") || line.startsWith("+++ ")) {
            continue; // redundant with the diff --git header, but present in real diffs
        }
        if (line.startsWith("Binary files")) {
            continue;
        }
        const hunkMatch = line.match(HUNK_HEADER_RE);
        if (hunkMatch) {
            pushHunk();
            oldLineNo = parseInt(hunkMatch[1], 10);
            newLineNo = parseInt(hunkMatch[3], 10);
            currentHunk = {
                oldStart: oldLineNo,
                oldLines: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
                newStart: newLineNo,
                newLines: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
                header: hunkMatch[5]?.trim() ?? "",
                lines: [],
            };
            continue;
        }
        if (!currentHunk)
            continue;
        if (line.startsWith("+")) {
            currentHunk.lines.push({
                type: "add",
                content: line.slice(1),
                newLineNumber: newLineNo,
            });
            newLineNo++;
        }
        else if (line.startsWith("-")) {
            currentHunk.lines.push({
                type: "del",
                content: line.slice(1),
                oldLineNumber: oldLineNo,
            });
            oldLineNo++;
        }
        else if (line.startsWith(" ")) {
            currentHunk.lines.push({
                type: "context",
                content: line.slice(1),
                oldLineNumber: oldLineNo,
                newLineNumber: newLineNo,
            });
            oldLineNo++;
            newLineNo++;
        }
        else if (line.startsWith("\\ No newline at end of file")) {
            continue;
        }
    }
    pushFile();
    return { files };
}
/** Renders a single file's hunks back to unified-diff text (for LLM prompts). */
function renderFileDiff(file) {
    const parts = [`--- ${file.path}`, `+++ ${file.path}`];
    for (const hunk of file.hunks) {
        parts.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ ${hunk.header}`);
        for (const l of hunk.lines) {
            const prefix = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
            parts.push(`${prefix}${l.content}`);
        }
    }
    return parts.join("\n");
}
/** List of changed (added) line numbers in the new file, used to filter static-analyzer output down to only lines actually touched by the diff. */
function changedNewLines(file) {
    const set = new Set();
    for (const hunk of file.hunks) {
        for (const l of hunk.lines) {
            if (l.type === "add" && l.newLineNumber)
                set.add(l.newLineNumber);
        }
    }
    return set;
}
