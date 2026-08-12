import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "./diffParse";

describe("parseUnifiedDiff", () => {
  test("numbers lines from the hunk header across several hunks", () => {
    const { hunks, additions, deletions } = parseUnifiedDiff(
      [
        "diff --git a/app.ts b/app.ts",
        "index 1111111..2222222 100644",
        "--- a/app.ts",
        "+++ b/app.ts",
        "@@ -10,4 +10,5 @@ function boot() {",
        " keep",
        "-gone",
        "+first",
        "+second",
        " tail",
        "@@ -40,3 +41,3 @@",
        " a",
        "-b",
        "+B",
        " c",
        "",
      ].join("\n"),
    );

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      oldStart: 10,
      oldLines: 4,
      newStart: 10,
      newLines: 5,
      header: "function boot() {",
    });
    expect(hunks[0]!.lines).toEqual([
      { kind: "context", text: "keep", oldLine: 10, newLine: 10 },
      { kind: "del", text: "gone", oldLine: 11, newLine: null },
      { kind: "add", text: "first", oldLine: null, newLine: 11 },
      { kind: "add", text: "second", oldLine: null, newLine: 12 },
      { kind: "context", text: "tail", oldLine: 12, newLine: 13 },
    ]);
    expect(hunks[1]!.lines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [40, 41],
      [41, null],
      [null, 42],
      [42, 43],
    ]);
    expect({ additions, deletions }).toEqual({ additions: 3, deletions: 2 });
  });

  test("an omitted count in the hunk header means one line", () => {
    const { hunks } = parseUnifiedDiff(["@@ -7 +7 @@", "-old", "+new", ""].join("\n"));

    expect(hunks[0]).toMatchObject({ oldStart: 7, oldLines: 1, newStart: 7, newLines: 1 });
  });

  test("a missing trailing newline marks the line it follows on either side", () => {
    const { hunks } = parseUnifiedDiff(
      ["@@ -1 +1 @@", "-old", "\\ No newline at end of file", "+new", "\\ No newline at end of file", ""].join(
        "\n",
      ),
    );

    expect(hunks[0]!.lines.map((line) => line.noNewline)).toEqual([true, true]);
  });

  test("a binary file yields no hunks", () => {
    const parsed = parseUnifiedDiff(
      [
        "diff --git a/logo.png b/logo.png",
        "index 1111111..2222222 100644",
        "Binary files a/logo.png and b/logo.png differ",
        "",
      ].join("\n"),
    );

    expect(parsed).toMatchObject({ isBinary: true, hunks: [], additions: 0, deletions: 0 });
  });

  test("an added file is all additions and a deleted file all deletions", () => {
    const added = parseUnifiedDiff(["@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n"));
    const deleted = parseUnifiedDiff(["@@ -1,2 +0,0 @@", "-one", "-two", ""].join("\n"));

    expect(added).toMatchObject({ additions: 2, deletions: 0 });
    expect(added.hunks[0]!.lines.map((line) => line.newLine)).toEqual([1, 2]);
    expect(deleted).toMatchObject({ additions: 0, deletions: 2 });
    expect(deleted.hunks[0]!.lines.map((line) => line.oldLine)).toEqual([1, 2]);
  });

  test("header lines are never mistaken for content", () => {
    const { hunks, additions, deletions } = parseUnifiedDiff(
      [
        "diff --git a/old.ts b/new.ts",
        "old mode 100644",
        "new mode 100755",
        "similarity index 92%",
        "rename from old.ts",
        "rename to new.ts",
        "index 1111111..2222222",
        "--- a/old.ts",
        "+++ b/new.ts",
        "@@ -1,2 +1,2 @@",
        " same",
        "-was",
        "+is",
        "",
      ].join("\n"),
    );

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(3);
    expect({ additions, deletions }).toEqual({ additions: 1, deletions: 1 });
  });
});
