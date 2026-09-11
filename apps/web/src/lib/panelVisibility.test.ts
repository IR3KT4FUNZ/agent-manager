import { describe, expect, test } from "bun:test";
import { sanitizeHiddenPanels } from "./panelVisibility";

describe("sanitizeHiddenPanels", () => {
  test("keeps known panel IDs once and discards invalid entries", () => {
    expect(sanitizeHiddenPanels(["chat", "unknown", "chat", null, "diff"])).toEqual([
      "diff",
      "chat",
    ]);
  });

  test("defaults to showing all panels for invalid stored values", () => {
    for (const value of [null, "chat", 3, { chat: true }]) {
      expect(sanitizeHiddenPanels(value)).toEqual([]);
    }
  });
});
