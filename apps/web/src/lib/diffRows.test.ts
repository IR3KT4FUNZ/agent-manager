import { describe, expect, test } from "bun:test";
import type { DiffHunk, DiffLine } from "@agent-manager/shared";
import { buildSideBySideRows } from "./diffRows";

function context(text: string, line: number): DiffLine {
  return { kind: "context", text, oldLine: line, newLine: line };
}

function del(text: string, oldLine: number): DiffLine {
  return { kind: "del", text, oldLine, newLine: null };
}

function add(text: string, newLine: number): DiffLine {
  return { kind: "add", text, oldLine: null, newLine };
}

function hunk(lines: DiffLine[]): DiffHunk {
  return { oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, header: "", lines };
}

describe("buildSideBySideRows", () => {
  test("context spans both sides", () => {
    const line = context("same", 1);

    expect(buildSideBySideRows(hunk([line]))).toEqual([{ old: line, new: line }]);
  });

  test("a removal run pairs with the addition run that follows it", () => {
    const rows = buildSideBySideRows(
      hunk([del("was", 4), del("also was", 5), add("is", 4), add("also is", 5)]),
    );

    expect(rows.map((row) => [row.old?.text, row.new?.text])).toEqual([
      ["was", "is"],
      ["also was", "also is"],
    ]);
  });

  test("an unpaired line leaves the opposite side empty", () => {
    const rows = buildSideBySideRows(hunk([del("gone", 1), add("one", 1), add("two", 2)]));

    expect(rows.map((row) => [row.old?.text ?? null, row.new?.text ?? null])).toEqual([
      ["gone", "one"],
      [null, "two"],
    ]);
  });

  test("pairing never reaches across a context line", () => {
    const rows = buildSideBySideRows(hunk([del("gone", 1), context("same", 2), add("new", 3)]));

    expect(rows.map((row) => [row.old?.text ?? null, row.new?.text ?? null])).toEqual([
      ["gone", null],
      ["same", "same"],
      [null, "new"],
    ]);
  });
});
