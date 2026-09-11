import { useCallback, useEffect, useRef, useState } from "react";
import type { FileDiff, PrSide } from "@agent-manager/shared";
import { diffComposers, type SelectionAnchor } from "./diffComposer";

export interface DiffDrag {
  side: PrSide;
  from: number;
  to: number;
}

export function useDiffSelection(sessionId: string, path: string, diff?: FileDiff) {
  const [drag, setDrag] = useState<DiffDrag | null>(null);
  const displayedDiff = useRef<FileDiff | null>(null);

  const openSelection = useCallback(
    (anchor: SelectionAnchor, snapshot = diff) => {
      if (snapshot) diffComposers.open(sessionId, snapshot, anchor);
    },
    [sessionId, diff],
  );

  function startSelection(anchor: SelectionAnchor) {
    displayedDiff.current = diff ?? null;
    setDrag({ side: anchor.side, from: anchor.line, to: anchor.line });
  }

  function extendSelection(anchor: SelectionAnchor) {
    setDrag((current) => {
      if (!current || current.side !== anchor.side) return current;
      return { ...current, to: anchor.line };
    });
  }

  useEffect(() => {
    if (!drag) return;
    const { side, from, to } = drag;

    function finishSelection() {
      openSelection(
        {
          side,
          line: Math.max(from, to),
          startLine: from === to ? undefined : Math.min(from, to),
        },
        displayedDiff.current ?? undefined,
      );
      setDrag(null);
    }

    function cancelSelection() {
      setDrag(null);
    }

    window.addEventListener("pointerup", finishSelection);
    window.addEventListener("pointercancel", cancelSelection);
    return () => {
      window.removeEventListener("pointerup", finishSelection);
      window.removeEventListener("pointercancel", cancelSelection);
    };
  }, [drag, openSelection, path]);

  return { drag, startSelection, extendSelection, openSelection };
}
