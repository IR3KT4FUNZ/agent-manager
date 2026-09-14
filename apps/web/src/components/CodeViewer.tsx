import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NavigationRequest, NavigationResult, SourceLocation } from "@agent-manager/shared";
import { ApiError, getSource, navigateCode } from "../lib/api";
import { groupLocations, supportsNavigation, useCodeHistory } from "../lib/codeHistory";
import { diffPositionAtPoint } from "../lib/diffPosition";
import { getWalkthroughSource } from "../lib/walkthrough";
import { DiffPathLabel, DiffViewer } from "./DiffViewer";

const SourceEditor = lazy(() => import("./SourceEditor"));
const button = "rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-30";

export function CodePanelHeader({ sessionId }: { sessionId: string }) {
  const { current, history, entries, index } = useCodeHistory(sessionId);
  if (!current) return null;
  return (
    <div
      className="flex min-w-0 items-center gap-1"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className={button}
        title="Back"
        aria-label="Back"
        disabled={index <= 0}
        onClick={() => history.move(-1)}
      >
        ←
      </button>
      <button
        className={button}
        title="Forward"
        aria-label="Forward"
        disabled={index >= entries.length - 1}
        onClick={() => history.move(1)}
      >
        →
      </button>
      {current.mode === "diff" ? (
        <DiffPathLabel sessionId={sessionId} path={current.path} />
      ) : (
        <span className="truncate font-mono text-[10px] text-zinc-400" title={current.path}>
          {current.path}
        </span>
      )}
      {current.mode === "diff" && (
        <button
          className={`${button} whitespace-nowrap`}
          onClick={() => history.visit({ mode: "source", path: current.path })}
        >
          Open source
        </button>
      )}
      <button
        className={button}
        title="Close code viewer"
        aria-label="Close code viewer"
        onClick={() => history.close()}
      >
        ✕
      </button>
    </div>
  );
}

function Results({
  result,
  onOpen,
}: {
  result: NavigationResult;
  onOpen: (location: SourceLocation) => void;
}) {
  return (
    <div
      className="max-h-56 shrink-0 overflow-auto border-t border-zinc-700 bg-zinc-950 p-2 text-xs"
      aria-label="Navigation results"
    >
      {result.message && <p className="p-1 text-amber-300">{result.message}</p>}
      {result.locations.length === 0 && <p className="p-1 text-zinc-400">No results found.</p>}
      {[...groupLocations(result.locations)].map(([path, locations]) => (
        <div key={path}>
          <p className="truncate px-1 py-2 font-mono text-zinc-400" title={path}>
            {path}
          </p>
          {locations.map((location) => (
            <button
              key={`${location.line}:${location.column}`}
              className="block w-full truncate rounded p-1 text-left font-mono text-zinc-300 hover:bg-zinc-800"
              onClick={() => onOpen(location)}
              title={location.preview}
            >
              {location.line}:{location.column} {location.preview}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CodeViewer({ sessionId }: { sessionId: string }) {
  const { current, index } = useCodeHistory(sessionId);
  if (!current) return null;
  return (
    <CodeViewBody
      key={`${sessionId}:${index}:${current.mode}:${current.path}`}
      sessionId={sessionId}
    />
  );
}

function CodeViewBody({ sessionId }: { sessionId: string }) {
  const { current: view, history } = useCodeHistory(sessionId);
  const queryClient = useQueryClient();
  const container = useRef<HTMLDivElement>(null);
  const active = useRef(true);
  const sequence = useRef(0);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<NavigationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<NavigationRequest | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    request: Omit<NavigationRequest, "action">;
  } | null>(null);
  const source = useQuery({
    queryKey: view?.walkthrough ? ["walkthrough-source", sessionId, view.walkthrough.version, view.walkthrough.nodeId] : ["source", sessionId, view?.path],
    queryFn: () => view?.walkthrough
      ? getWalkthroughSource(sessionId, view.walkthrough.version, view.walkthrough.nodeId)
      : getSource(sessionId, view!.path),
    enabled: view?.mode === "source",
    refetchInterval: 3_000,
    retry: false,
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const dismiss = () => setMenu(null);
    window.addEventListener("click", dismiss);
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("keydown", dismiss);
    };
  }, [menu]);
  const open = (location: SourceLocation) => history.visit({ mode: "source", ...location });
  const navigate = async (request: NavigationRequest) => {
    const requestId = ++sequence.current;
    setMenu(null);
    setPending(true);
    setError(null);
    setResult(null);
    setRetry(null);
    try {
      const response = await navigateCode(sessionId, request);
      if (!active.current || sequence.current !== requestId) return;
      if (request.action === "definition" && response.locations.length === 1 && !response.message)
        open(response.locations[0]!);
      else setResult(response);
    } catch (failure) {
      if (!active.current || sequence.current !== requestId) return;
      setError(failure instanceof Error ? failure.message : String(failure));
      if (failure instanceof ApiError && failure.status === 409) {
        void queryClient.invalidateQueries({
          queryKey: ["source", sessionId, request.path],
        });
        void queryClient.invalidateQueries({
          queryKey: ["diff", sessionId, request.path],
        });
      } else setRetry(request);
    } finally {
      if (active.current && sequence.current === requestId) setPending(false);
    }
  };
  if (!view) return null;
  const stale = source.data && view.version && view.version !== source.data.version;
  return (
    <div
      ref={container}
      className="flex h-full min-h-0 flex-col bg-zinc-900"
      onMouseUp={() => {
        if (view.mode !== "diff") return;
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const start =
          range.startContainer.parentElement?.closest<HTMLElement>("[data-side][data-line]");
        const end =
          range.endContainer.parentElement?.closest<HTMLElement>("[data-side][data-line]");
        if (
          !start ||
          !end ||
          start.dataset.side !== end.dataset.side ||
          !container.current?.contains(start)
        )
          return;
        if (
          !range.startContainer.parentElement?.closest("[data-code-text]") ||
          !range.endContainer.parentElement?.closest("[data-code-text]")
        )
          return;
        history.save({
          line: Number(start.dataset.line),
          column: range.startOffset + 1,
          endLine: Number(end.dataset.line),
          endColumn: range.endOffset + 1,
          side: start.dataset.side as "old" | "new",
        });
      }}
      onClick={(event) => {
        if (view.mode !== "diff" || !(event.metaKey || event.ctrlKey)) return;
        const position = diffPositionAtPoint(event.target, event.clientX, event.clientY);
        const version =
          container.current?.querySelector<HTMLElement>("[data-current-version]")?.dataset
            .currentVersion;
        if (position && version && supportsNavigation(position.path)) {
          event.preventDefault();
          void navigate({ ...position, version, action: "definition" });
        }
      }}
      onContextMenu={(event) => {
        if (view.mode !== "diff") return;
        const position = diffPositionAtPoint(event.target, event.clientX, event.clientY);
        const version =
          container.current?.querySelector<HTMLElement>("[data-current-version]")?.dataset
            .currentVersion;
        if (position && version && supportsNavigation(position.path)) {
          event.preventDefault();
          setMenu({
            x: Math.min(event.clientX, window.innerWidth - 190),
            y: Math.min(event.clientY, window.innerHeight - 90),
            request: { ...position, version },
          });
        }
      }}
    >
      {pending && (
        <p role="status" className="px-3 py-2 text-xs text-zinc-400">
          Finding code…
        </p>
      )}
      {(error || stale) && (
        <div role="alert" className="px-3 py-2 text-xs text-amber-300">
          {error ??
            "This file changed since navigation. Select the symbol again in the refreshed source."}
          {retry && (
            <button className={button} onClick={() => void navigate(retry)}>
              Retry
            </button>
          )}
        </div>
      )}
      {view.walkthrough?.side === "old" && view.mode === "source" && (
        <p className="px-3 py-2 text-xs text-zinc-500">Base revision source · read-only historical context</p>
      )}
      {!supportsNavigation(view.path) && (
        <p className="px-3 py-2 text-xs text-zinc-500">
          Code navigation supports TypeScript and JavaScript files.
        </p>
      )}
      <div className="min-h-0 flex-1">
        {view.mode === "diff" ? (
          <DiffViewer
            sessionId={sessionId}
            path={view.path}
            view={view}
            onSave={(state) => history.save(state)}
          />
        ) : source.isLoading ? (
          <p className="p-3 text-xs text-zinc-400">Loading source…</p>
        ) : source.error ? (
          <p role="alert" className="p-3 text-xs text-amber-300">
            {source.error.message}{" "}
            <button className={button} onClick={() => void source.refetch()}>
              Retry
            </button>
          </p>
        ) : source.data ? (
          <Suspense fallback={<p className="p-3 text-xs text-zinc-400">Loading viewer…</p>}>
            <SourceEditor
              sessionId={sessionId}
              source={source.data}
              view={view}
              onNavigate={(request) => void navigate(request)}
              onSave={(state) => history.save(state)}
            />
          </Suspense>
        ) : null}
      </div>
      {result && (
        <>
          <button className={`${button} self-end`} onClick={() => setResult(null)}>
            Close results
          </button>
          <Results result={result} onOpen={open} />
        </>
      )}
      {menu && (
        <div
          role="menu"
          className="fixed z-50 rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          {(["definition", "references"] as const).map((action) => (
            <button
              key={action}
              role="menuitem"
              className={`${button} block w-full text-left`}
              onClick={() => void navigate({ ...menu.request, action })}
            >
              {action === "definition" ? "Go to definition" : "Find references"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
