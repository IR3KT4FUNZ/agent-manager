import { describe, expect, test } from "bun:test";
import {
  clampSize,
  MIN_PANEL_WIDTH,
  MIN_SPLIT_HEIGHT,
  sanitizePanelWidths,
  sanitizeSplitHeight,
} from "./paneSizes";

describe("clampSize", () => {
  test("keeps a size that fits", () => {
    expect(clampSize(300.4, MIN_PANEL_WIDTH, 500)).toBe(300);
  });

  test("never goes below the minimum", () => {
    expect(clampSize(10, MIN_PANEL_WIDTH, 500)).toBe(MIN_PANEL_WIDTH);
  });

  test("never grows past the space the flexible pane can give up", () => {
    expect(clampSize(900, MIN_PANEL_WIDTH, 400)).toBe(400);
  });

  test("the minimum wins over a maximum that is smaller still", () => {
    expect(clampSize(400, MIN_PANEL_WIDTH, 40)).toBe(MIN_PANEL_WIDTH);
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

describe("sanitizeSplitHeight", () => {
  test("keeps a stored height", () => {
    expect(sanitizeSplitHeight(String(MIN_SPLIT_HEIGHT + 100))).toBe(MIN_SPLIT_HEIGHT + 100);
  });

  test("falls back to equal halves when nothing usable is stored", () => {
    for (const value of [null, "", "tall", "0", String(MIN_SPLIT_HEIGHT - 1)]) {
      expect(sanitizeSplitHeight(value)).toBeNull();
    }
  });
});
