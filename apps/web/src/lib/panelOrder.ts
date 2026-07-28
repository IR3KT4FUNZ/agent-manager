import { useEffect, useState } from "react";

export type PanelId = "sessions" | "changes" | "chat";

export const DEFAULT_PANEL_ORDER: readonly PanelId[] = ["sessions", "changes", "chat"];

const STORAGE_KEY = "agent-manager.panel-order";

export function sanitizePanelOrder(value: unknown): PanelId[] {
  if (
    Array.isArray(value) &&
    value.length === DEFAULT_PANEL_ORDER.length &&
    DEFAULT_PANEL_ORDER.every((id) => value.includes(id))
  ) {
    return value as PanelId[];
  }
  return [...DEFAULT_PANEL_ORDER];
}

export function reorderPanels(order: PanelId[], dragged: PanelId, target: PanelId): PanelId[] {
  if (dragged === target) return order;
  const targetIndex = order.indexOf(target);
  const next = order.filter((id) => id !== dragged);
  next.splice(targetIndex, 0, dragged);
  return next;
}

function loadPanelOrder(): PanelId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizePanelOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return [...DEFAULT_PANEL_ORDER];
  }
}

export function usePanelOrder() {
  const [order, setOrder] = useState<PanelId[]>(loadPanelOrder);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch {}
  }, [order]);

  const movePanel = (dragged: PanelId, target: PanelId) =>
    setOrder((prev) => reorderPanels(prev, dragged, target));

  return { order, movePanel };
}
