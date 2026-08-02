import { useEffect, useState } from "react";
import { DEFAULT_PANEL_ORDER, type PanelId } from "./panelOrder";

export type PanelWidths = Partial<Record<PanelId, number>>;

export const MIN_PANEL_WIDTH = 160;

const STORAGE_KEY = "agent-manager.panel-widths";

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

export function clampPanelWidth(width: number, maxWidth: number): number {
  return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), Math.max(maxWidth, MIN_PANEL_WIDTH)));
}

function loadPanelWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizePanelWidths(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

export function usePanelWidths() {
  const [widths, setWidths] = useState<PanelWidths>(loadPanelWidths);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {}
  }, [widths]);

  const setPanelWidth = (id: PanelId, width: number) =>
    setWidths((prev) => (prev[id] === width ? prev : { ...prev, [id]: width }));

  return { widths, setPanelWidth };
}
