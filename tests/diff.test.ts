import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, changedNewLines } from "../src/diff/parse";
import { buildChunks, globToRegExp, isIgnored } from "../src/diff/chunk";

const SAMPLE_DIFF = `diff --git a/src/foo.js b/src/foo.js
index abc1234..def5678 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,4 +1,5 @@
 function foo() {
-  return 1;
+  return 2;
+  // added comment
 }
 module.exports = foo;
`;

test("parseUnifiedDiff extracts file path and hunk boundaries", () => {
  const result = parseUnifiedDiff(SAMPLE_DIFF);
  assert.equal(result.files.length, 1);
  const file = result.files[0];
  assert.equal(file.path, "src/foo.js");
  assert.equal(file.isNew, false);
  assert.equal(file.hunks.length, 1);
  assert.equal(file.hunks[0].oldStart, 1);
  assert.equal(file.hunks[0].newStart, 1);
});

test("parseUnifiedDiff assigns correct new-file line numbers to added lines", () => {
  const result = parseUnifiedDiff(SAMPLE_DIFF);
  const addedLines = result.files[0].hunks[0].lines.filter((l) => l.type === "add");
  assert.equal(addedLines.length, 2);
  assert.equal(addedLines[0].content, "  return 2;");
  assert.equal(addedLines[0].newLineNumber, 2);
  assert.equal(addedLines[1].content, "  // added comment");
  assert.equal(addedLines[1].newLineNumber, 3);
});

test("changedNewLines returns only added line numbers, not context/deleted", () => {
  const result = parseUnifiedDiff(SAMPLE_DIFF);
  const changed = changedNewLines(result.files[0]);
  assert.deepEqual([...changed].sort(), [2, 3]);
});

test("parseUnifiedDiff marks new files correctly", () => {
  const newFileDiff = `diff --git a/added.js b/added.js
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/added.js
@@ -0,0 +1,2 @@
+const x = 1;
+module.exports = x;
`;
  const result = parseUnifiedDiff(newFileDiff);
  assert.equal(result.files[0].isNew, true);
  assert.equal(result.files[0].hunks[0].lines.length, 2);
});

test("globToRegExp handles ** and * for typical ignore patterns", () => {
  assert.equal(globToRegExp("**/*.lock").test("yarn.lock"), true);
  assert.equal(globToRegExp("**/*.lock").test("a/b/c/yarn.lock"), true);
  assert.equal(globToRegExp("**/*.lock").test("yarn.lock.bak"), false);
  assert.equal(globToRegExp("**/dist/**").test("packages/app/dist/index.js"), true);
  assert.equal(globToRegExp("**/dist/**").test("packages/app/src/index.js"), false);
});

test("isIgnored matches against a list of patterns", () => {
  const patterns = ["**/*.lock", "**/node_modules/**"];
  assert.equal(isIgnored("package-lock.json".replace("json", "lock"), patterns), true);
  assert.equal(isIgnored("node_modules/foo/index.js", patterns), true);
  assert.equal(isIgnored("src/index.js", patterns), false);
});

test("buildChunks keeps a single oversized hunk whole rather than splitting mid-hunk", () => {
  // Splitting inside a hunk would strip the surrounding context the model
  // needs to judge intent — one large hunk should always ship as one chunk,
  // even over budget. This is documented behavior in chunk.ts, not a bug.
  const bigDiff = `diff --git a/big.js b/big.js
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/big.js
@@ -0,0 +1,3 @@
+${"a".repeat(50)}
+${"b".repeat(50)}
+${"c".repeat(50)}
`;
  const parsed = parseUnifiedDiff(bigDiff);
  const chunks = buildChunks(parsed, [], 60);
  assert.equal(chunks.length, 1);
});

test("buildChunks splits a file into multiple chunks once separate hunks exceed the char budget", () => {
  const mkHunk = (newStart: number, filler: string) => ({
    oldStart: newStart,
    oldLines: 1,
    newStart,
    newLines: 2,
    header: "",
    lines: [
      { type: "context" as const, content: "context", oldLineNumber: newStart, newLineNumber: newStart },
      { type: "add" as const, content: filler, newLineNumber: newStart + 1 },
    ],
  });
  const file = {
    path: "big.js",
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    hunks: [mkHunk(1, "a".repeat(40)), mkHunk(20, "b".repeat(40))],
  };
  // Each hunk alone is ~49 chars; both together (~99) exceed a 60-char budget.
  const chunks = buildChunks({ files: [file] }, [], 60);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text.includes("a".repeat(40)), true);
  assert.equal(chunks[1].text.includes("b".repeat(40)), true);
});

test("buildChunks skips files matching ignorePaths", () => {
  const diff = `diff --git a/yarn.lock b/yarn.lock
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/yarn.lock
@@ -0,0 +1,1 @@
+lockfile content
`;
  const parsed = parseUnifiedDiff(diff);
  const chunks = buildChunks(parsed, ["**/*.lock"], 6000);
  assert.equal(chunks.length, 0);
});
