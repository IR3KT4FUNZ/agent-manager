import { describe, expect, test } from "bun:test";
import { DEFAULT_PANEL_ORDER, reorderPanels, sanitizePanelOrder } from "./panelOrder";

describe("reorderPanels", () => {
  test("dragging onto a later panel takes that panel's slot", () => {
    expect(reorderPanels(["sessions", "changes", "chat"], "sessions", "chat")).toEqual([
      "changes",
      "chat",
      "sessions",
    ]);
  });

  test("dragging onto an earlier panel takes that panel's slot", () => {
    expect(reorderPanels(["sessions", "changes", "chat"], "chat", "sessions")).toEqual([
      "chat",
      "sessions",
      "changes",
    ]);
  });

  test("adjacent panels swap", () => {
    expect(reorderPanels(["sessions", "changes", "chat"], "changes", "sessions")).toEqual([
      "changes",
      "sessions",
      "chat",
    ]);
  });

  test("dropping a panel onto itself changes nothing", () => {
    const order: ("sessions" | "changes" | "chat")[] = ["sessions", "changes", "chat"];
    expect(reorderPanels(order, "changes", "changes")).toEqual(order);
  });
});

describe("sanitizePanelOrder", () => {
  test("accepts a stored permutation", () => {
    expect(sanitizePanelOrder(["chat", "sessions", "changes"])).toEqual([
      "chat",
      "sessions",
      "changes",
    ]);
  });

  test("falls back to the default order for invalid values", () => {
    const invalid = [null, "chat", [], ["chat", "chat", "chat"], ["chat", "sessions", "bogus"]];
    for (const value of invalid) {
      expect(sanitizePanelOrder(value)).toEqual([...DEFAULT_PANEL_ORDER]);
    }
  });
});
