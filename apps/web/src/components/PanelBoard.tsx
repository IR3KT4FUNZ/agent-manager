import { useState, type ReactNode } from "react";
import { usePanelOrder, type PanelId } from "../lib/panelOrder";

export interface PanelSpec {
  id: PanelId;
  className?: string;
  content: ReactNode;
}

export function PanelBoard({ panels }: { panels: PanelSpec[] }) {
  const { order, movePanel } = usePanelOrder();
  const [dragging, setDragging] = useState<PanelId | null>(null);

  const position = (id: PanelId) => order.indexOf(id);
  const leftmost = Math.min(...panels.map((panel) => position(panel.id)));

  return (
    <div className="flex h-full min-w-0 flex-1">
      {panels.map((panel) => (
        <section
          key={panel.id}
          data-panel={panel.id}
          style={{ order: position(panel.id) }}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            if (dragging !== panel.id) movePanel(dragging, panel.id);
          }}
          onDrop={(event) => event.preventDefault()}
          className={`flex min-w-0 flex-col ${
            position(panel.id) === leftmost ? "" : "border-l border-zinc-800"
          } ${dragging === panel.id ? "opacity-60" : ""} ${panel.className ?? ""}`}
        >
          <div
            draggable
            onDragStart={(event) => {
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", panel.id);
              }
              setDragging(panel.id);
            }}
            onDragEnd={() => setDragging(null)}
            title="Drag to move this panel"
            className="flex h-4 shrink-0 cursor-grab items-center justify-center border-b border-zinc-800 bg-zinc-900 text-zinc-600 hover:text-zinc-300 active:cursor-grabbing"
          >
            <span className="text-[9px] leading-none tracking-[0.2em]">•••</span>
          </div>
          <div className="min-h-0 min-w-0 flex-1">{panel.content}</div>
        </section>
      ))}
    </div>
  );
}
