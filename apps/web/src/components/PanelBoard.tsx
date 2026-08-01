import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { usePanelOrder, type PanelId } from "../lib/panelOrder";

export interface PanelSpec {
  id: PanelId;
  title: string;
  headerRight?: ReactNode;
  className?: string;
  content: ReactNode;
}

const DRAG_THRESHOLD_PX = 4;

function panelIdAt(x: number, y: number): PanelId | null {
  const panel = document.elementFromPoint(x, y)?.closest("[data-panel]");
  return (panel?.getAttribute("data-panel") as PanelId | undefined) ?? null;
}

export function PanelBoard({ panels }: { panels: PanelSpec[] }) {
  const { order, movePanel } = usePanelOrder();
  const [drag, setDrag] = useState<{ id: PanelId; over: PanelId } | null>(null);
  const pressRef = useRef<{ id: PanelId; x: number; y: number } | null>(null);

  const position = (id: PanelId) => order.indexOf(id);
  const leftmost = Math.min(...panels.map((panel) => position(panel.id)));

  function beginPress(event: PointerEvent<HTMLElement>, id: PanelId) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = { id, x: event.clientX, y: event.clientY };
  }

  function trackPointer(event: PointerEvent<HTMLElement>) {
    const press = pressRef.current;
    if (!press) return;
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (!drag && moved < DRAG_THRESHOLD_PX) return;
    const over = panelIdAt(event.clientX, event.clientY) ?? press.id;
    setDrag((current) => (current?.over === over ? current : { id: press.id, over }));
  }

  function endPress(event: PointerEvent<HTMLElement>) {
    pressRef.current = null;
    if (drag) {
      const over = panelIdAt(event.clientX, event.clientY);
      if (over && over !== drag.id) movePanel(drag.id, over);
    }
    setDrag(null);
  }

  function cancelPress() {
    pressRef.current = null;
    setDrag(null);
  }

  return (
    <div className="flex h-full min-w-0 flex-1">
      {panels.map((panel) => {
        const isSource = drag?.id === panel.id;
        const isTarget = drag != null && drag.over === panel.id && drag.id !== panel.id;
        return (
          <section
            key={panel.id}
            data-panel={panel.id}
            style={{ order: position(panel.id) }}
            className={`flex min-w-0 flex-col ${
              position(panel.id) === leftmost ? "" : "border-l border-zinc-800"
            } ${isSource ? "opacity-50" : ""} ${
              isTarget ? "ring-1 ring-zinc-500 ring-inset" : ""
            } ${panel.className ?? ""}`}
          >
            <header
              onPointerDown={(event) => beginPress(event, panel.id)}
              onPointerMove={trackPointer}
              onPointerUp={endPress}
              onPointerCancel={cancelPress}
              title="Drag to move this panel"
              className={`flex h-9 shrink-0 touch-none items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-3 select-none ${
                drag ? "cursor-grabbing" : "cursor-grab"
              }`}
            >
              <span className="truncate text-xs font-semibold tracking-wide text-zinc-300">
                {panel.title}
              </span>
              {panel.headerRight && <div className="ml-auto min-w-0">{panel.headerRight}</div>}
            </header>
            <div className="min-h-0 min-w-0 flex-1">{panel.content}</div>
          </section>
        );
      })}
    </div>
  );
}
