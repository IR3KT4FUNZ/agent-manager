import { describe, expect, test } from "bun:test";
import { clampPanelWidth, MIN_PANEL_WIDTH, sanitizePanelWidths } from "./panelWidths";

describe("clampPanelWidth", () => {
  test("keeps a width that fits", () => {
    expect(clampPanelWidth(300.4, 500)).toBe(300);
  });

  test("never goes below the minimum", () => {
    expect(clampPanelWidth(10, 500)).toBe(MIN_PANEL_WIDTH);
  });

  test("never grows past the space the flexible panel can give up", () => {
    expect(clampPanelWidth(900, 400)).toBe(400);
  });

  test("the minimum wins over a maximum that is smaller still", () => {
    expect(clampPanelWidth(400, 40)).toBe(MIN_PANEL_WIDTH);
  });
});

describe("sanitizePanelWidths", () => {
  test("keeps stored widths for known panels", () => {
    expect(sanitizePanelWidths({ sessions: 240, chat: 600 })).toEqual({ sessions: 240, chat: 600 });
  });

  test("drops unknown panels and unusable widths", () => {
    expect(
      sanitizePanelWidths({ bogus: 240, sessions: "240", changes: 10, chat: Number.NaN }),
    ).toEqual({});
  });

  test("falls back to no widths for non-objects", () => {
    for (const value of [null, 3, "wide", [240, 600]]) {
      expect(sanitizePanelWidths(value)).toEqual({});
    }
  });
});
