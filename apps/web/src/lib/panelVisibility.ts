import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PANEL_ORDER, type PanelId } from "./panelOrder";

const STORAGE_KEY = "agent-manager.hidden-panels";

export function sanitizeHiddenPanels(value: unknown): PanelId[] {
  if (!Array.isArray(value)) return [];
  return DEFAULT_PANEL_ORDER.filter((id) => value.includes(id));
}

function loadHiddenPanels(): PanelId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitizeHiddenPanels(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

export function usePanelVisibility() {
  const [hiddenPanels, setHiddenPanels] = useState<PanelId[]>(loadHiddenPanels);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hiddenPanels));
    } catch {}
  }, [hiddenPanels]);

  const togglePanel = (id: PanelId) =>
    setHiddenPanels((current) =>
      current.includes(id) ? current.filter((panel) => panel !== id) : [...current, id],
    );

  const showPanel = useCallback((id: PanelId) => {
    setHiddenPanels((current) =>
      current.includes(id) ? current.filter((panel) => panel !== id) : current,
    );
  }, []);

  const showAllPanels = () => setHiddenPanels([]);

  return { hiddenPanels, togglePanel, showPanel, showAllPanels };
}
