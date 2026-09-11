import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { usePanelOrder, type PanelId } from "../lib/panelOrder";
import { clampSize, MIN_PANEL_WIDTH, usePanelWidths } from "../lib/paneSizes";
import { usePanelVisibility } from "../lib/panelVisibility";

export interface PanelSpec {
  id: PanelId;
  title: string;
  headerRight?: ReactNode;
  defaultWidth: number;
  content: ReactNode;
  revealKey?: unknown;
}

const DRAG_THRESHOLD_PX = 4;

function panelIdAt(x: number, y: number): PanelId | null {
  const panel = document.elementFromPoint(x, y)?.closest("[data-panel]");
  return (panel?.getAttribute("data-panel") as PanelId | undefined) ?? null;
}

export function PanelBoard({ panels }: { panels: PanelSpec[] }) {
  const { order, movePanel } = usePanelOrder();
  const { widths, setPanelWidth } = usePanelWidths();
  const { hiddenPanels, togglePanel, showPanel, showAllPanels } = usePanelVisibility();
  const revealKeysRef = useRef(new Map<PanelId, unknown>());
  const [drag, setDrag] = useState<{ id: PanelId; over: PanelId } | null>(null);
  const [resizing, setResizing] = useState(false);
  const pressRef = useRef<{ id: PanelId; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ id: PanelId; x: number; width: number; maxWidth: number } | null>(
    null,
  );
  const elementsRef = useRef(new Map<PanelId, HTMLElement>());

  const position = (id: PanelId) => order.indexOf(id);
  const orderedPanels = [...panels].sort((a, b) => position(a.id) - position(b.id));
  const laidOut = orderedPanels.filter((panel) => !hiddenPanels.includes(panel.id));
  const flexible = laidOut[laidOut.length - 1];
  const widthOf = (panel: PanelSpec) => widths[panel.id] ?? panel.defaultWidth;

  useEffect(() => {
    for (const panel of panels) {
      if (panel.revealKey !== undefined && panel.revealKey !== revealKeysRef.current.get(panel.id)) {
        showPanel(panel.id);
      }
    }
    revealKeysRef.current = new Map(panels.map((panel) => [panel.id, panel.revealKey]));
  }, [panels, showPanel]);

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

  function beginResize(event: PointerEvent<HTMLElement>, id: PanelId) {
    if (event.button !== 0 || !flexible) return;
    event.preventDefault();
    const width = elementsRef.current.get(id)?.getBoundingClientRect().width;
    if (width === undefined) return;
    const flexibleWidth = elementsRef.current.get(flexible.id)?.getBoundingClientRect().width ?? 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      id,
      x: event.clientX,
      width,
      maxWidth: width + Math.max(0, flexibleWidth - MIN_PANEL_WIDTH),
    };
    setResizing(true);
  }

  function trackResize(event: PointerEvent<HTMLElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const desired = resize.width + (event.clientX - resize.x);
    setPanelWidth(resize.id, clampSize(desired, MIN_PANEL_WIDTH, resize.maxWidth));
  }

  function endResize() {
    resizeRef.current = null;
    setResizing(false);
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div
        role="group"
        aria-label="Panel visibility"
        className="flex shrink-0 flex-wrap items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1"
      >
        <span className="mr-1 text-xs text-zinc-500">Panels</span>
        {orderedPanels.map((panel) => {
          const visible = !hiddenPanels.includes(panel.id);
          return (
            <button
              key={panel.id}
              type="button"
              aria-pressed={visible}
              title={`${visible ? "Hide" : "Show"} ${panel.title} panel`}
              onClick={() => togglePanel(panel.id)}
              className={`rounded px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-zinc-400 ${
                visible
                  ? "bg-zinc-700 text-zinc-100 hover:bg-zinc-600"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {panel.title}
            </button>
          );
        })}
        {laidOut.length < panels.length && (
          <button
            type="button"
            onClick={showAllPanels}
            className="ml-auto rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-zinc-400"
          >
            Show all
          </button>
        )}
      </div>
      <div className={`flex min-h-0 min-w-0 flex-1 ${resizing ? "select-none" : ""}`}>
        {panels.map((panel) => {
          const isSource = drag?.id === panel.id;
          const isTarget = drag != null && drag.over === panel.id && drag.id !== panel.id;
          const isHidden = hiddenPanels.includes(panel.id);
          const isFlexible = panel.id === flexible?.id;
          const before = laidOut[laidOut.indexOf(panel) - 1];
          return (
            <section
              key={panel.id}
              data-panel={panel.id}
              ref={(element) => {
                if (element) elementsRef.current.set(panel.id, element);
                else elementsRef.current.delete(panel.id);
              }}
              style={{
                display: isHidden ? "none" : undefined,
                order: position(panel.id),
                flex: isFlexible ? "1 1 auto" : `0 1 ${widthOf(panel)}px`,
                minWidth: MIN_PANEL_WIDTH,
              }}
              className={`relative flex flex-col ${
                before ? "border-l border-zinc-800" : ""
              } ${isSource ? "opacity-50" : ""} ${isTarget ? "ring-1 ring-zinc-500 ring-inset" : ""}`}
            >
              {before && (
                <div
                  onPointerDown={(event) => beginResize(event, before.id)}
                  onPointerMove={trackResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onDoubleClick={() => setPanelWidth(before.id, before.defaultWidth)}
                  title="Drag to resize · double-click to reset"
                  className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-zinc-600"
                />
              )}
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
        {laidOut.length === 0 && (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-zinc-500">
            All panels are hidden. Select a panel above to show it.
          </div>
        )}
      </div>
    </div>
  );
}
