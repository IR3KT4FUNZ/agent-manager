import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { clampSize, MIN_SPLIT_HEIGHT, useSplitHeight } from "../lib/paneSizes";

const EQUAL_HALVES = { flex: "1 1 0px", minHeight: MIN_SPLIT_HEIGHT };

export function VerticalSplit({
  storageKey,
  top,
  bottom,
}: {
  storageKey: string;
  top: ReactNode;
  bottom: ReactNode;
}) {
  const { height, setHeight } = useSplitHeight(storageKey);
  const [resizing, setResizing] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ y: number; height: number; maxHeight: number } | null>(null);

  function beginResize(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const topHeight = topRef.current?.getBoundingClientRect().height;
    const bottomHeight = bottomRef.current?.getBoundingClientRect().height;
    if (topHeight === undefined || bottomHeight === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      y: event.clientY,
      height: topHeight,
      maxHeight: topHeight + Math.max(0, bottomHeight - MIN_SPLIT_HEIGHT),
    };
    setResizing(true);
  }

  function trackResize(event: PointerEvent<HTMLElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const desired = resize.height + (event.clientY - resize.y);
    setHeight(clampSize(desired, MIN_SPLIT_HEIGHT, resize.maxHeight));
  }

  function endResize() {
    resizeRef.current = null;
    setResizing(false);
  }

  return (
    <div className={`flex h-full min-h-0 flex-col ${resizing ? "select-none" : ""}`}>
      <div
        ref={topRef}
        className="flex min-h-0 flex-col"
        style={
          height === null ? EQUAL_HALVES : { flex: `0 1 ${height}px`, minHeight: MIN_SPLIT_HEIGHT }
        }
      >
        {top}
      </div>
      <div
        ref={bottomRef}
        className="relative min-h-0 border-t border-zinc-800"
        style={EQUAL_HALVES}
      >
        <div
          onPointerDown={beginResize}
          onPointerMove={trackResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onDoubleClick={() => setHeight(null)}
          title="Drag to resize · double-click to reset"
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none bg-transparent transition-colors hover:bg-zinc-600"
        />
        {bottom}
      </div>
    </div>
  );
}
