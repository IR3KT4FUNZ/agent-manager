import { useEffect, useState } from "react";
import { DEFAULT_PANEL_ORDER, type PanelId } from "./panelOrder";

export type PanelWidths = Partial<Record<PanelId, number>>;

export const MIN_PANEL_WIDTH = 160;
export const MIN_SPLIT_HEIGHT = 72;

const WIDTHS_KEY = "agent-manager.panel-widths";

export function clampSize(size: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(size, min), Math.max(max, min)));
}

export function sanitizePanelWidths(value: unknown): PanelWidths {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const valid = Object.entries(value).filter(
    ([id, width]) =>
      DEFAULT_PANEL_ORDER.includes(id as PanelId) &&
      typeof width === "number" &&
      Number.isFinite(width) &&
      width >= MIN_PANEL_WIDTH,
  );
  return Object.fromEntries(valid) as PanelWidths;
}

export function sanitizeSplitHeight(value: string | null): number | null {
  const height = Number(value);
  return value !== null && Number.isFinite(height) && height >= MIN_SPLIT_HEIGHT ? height : null;
}

function loadPanelWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem(WIDTHS_KEY);
    return sanitizePanelWidths(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export function usePanelWidths() {
  const [widths, setWidths] = useState<PanelWidths>(loadPanelWidths);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
    } catch {}
  }, [widths]);

  const setPanelWidth = (id: PanelId, width: number) =>
    setWidths((prev) => (prev[id] === width ? prev : { ...prev, [id]: width }));

  return { widths, setPanelWidth };
}

export function useSplitHeight(storageKey: string) {
  const [height, setHeight] = useState<number | null>(() => {
    try {
      return sanitizeSplitHeight(localStorage.getItem(storageKey));
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (height === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(height));
    } catch {}
  }, [storageKey, height]);

  return { height, setHeight };
}
