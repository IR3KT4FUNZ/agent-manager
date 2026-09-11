import { expect, test } from "bun:test";
import { CodeHistory, groupLocations, supportsNavigation } from "./codeHistory";

test("history restores diff/source positions and truncates forward entries after a new jump", () => {
  const history = new CodeHistory();
  history.visit({ mode: "diff", path: "app.ts" });
  history.save({ scrollTop: 150, scrollLeft: 40 });
  history.visit({ mode: "source", path: "helper.ts", line: 8, column: 4 });
  history.save({ scrollTop: 300, endLine: 8, endColumn: 10 });
  history.move(-1);
  expect(history.snapshot().entries[history.snapshot().index]).toMatchObject({
    mode: "diff",
    scrollTop: 150,
    scrollLeft: 40,
  });
  history.move(1);
  expect(history.snapshot().entries[history.snapshot().index]).toMatchObject({
    path: "helper.ts",
    line: 8,
    endColumn: 10,
    scrollTop: 300,
  });
  history.move(-1);
  history.visit({ mode: "source", path: "other.ts" });
  expect(history.snapshot().entries.map((item) => item.path)).toEqual(["app.ts", "other.ts"]);
  history.close();
  expect(history.snapshot().open).toBe(false);
  history.move(-1);
  expect(history.snapshot().open).toBe(true);
});

test("result grouping preserves ranges and supported languages exclude unrelated files", () => {
  const locations = ["a.ts", "b.ts", "a.ts"].map((path, index) => ({
    path,
    line: index + 1,
    column: 1,
    endLine: index + 1,
    endColumn: 2,
    version: "v",
    preview: "value",
  }));
  expect(
    groupLocations(locations)
      .get("a.ts")
      ?.map((item) => item.line),
  ).toEqual([1, 3]);
  expect(["a.ts", "a.tsx", "a.js", "a.jsx", "a.mts", "a.cjs"].every(supportsNavigation)).toBe(true);
  expect(supportsNavigation("a.py")).toBe(false);
});
