import { Fragment, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DiffHunk, DiffLine, FileDiff } from "@agent-manager/shared";
import { buildSideBySideRows, type DiffRow } from "../lib/diffRows";
import { getFileDiff } from "../lib/api";
import {
  anchorKey,
  OutdatedThreads,
  ThreadCard,
  usePrThreads,
  type FileThreads,
} from "./PrThreads";

const SIDE_TINT = {
  add: { background: "bg-emerald-500/10", text: "text-emerald-200" },
  del: { background: "bg-rose-500/10", text: "text-rose-200" },
  context: { background: "", text: "text-zinc-300" },
  empty: { background: "bg-zinc-950/60", text: "" },
} as const;

function useFileDiff(sessionId: string, path: string) {
  return useQuery({
    queryKey: ["diff", sessionId, path],
    queryFn: () => getFileDiff(sessionId, path),
    refetchInterval: 3_000,
    retry: false,
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Message({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-zinc-500">{children}</p>;
}

function SideCell({
  path,
  side,
  line,
}: {
  path: string;
  side: "old" | "new";
  line: DiffLine | null;
}) {
  const number = side === "old" ? (line?.oldLine ?? null) : (line?.newLine ?? null);
  const tint = line ? SIDE_TINT[line.kind] : SIDE_TINT.empty;
  return (
    <>
      <div
        className={`shrink-0 px-2 text-right tabular-nums text-zinc-600 select-none ${tint.background}`}
        aria-hidden
      >
        {number ?? ""}
      </div>
      <div
        data-path={path}
        data-side={side}
        data-line={number ?? undefined}
        className={`px-2 whitespace-pre ${tint.background} ${tint.text}`}
      >
        {line?.text ?? ""}
        {line?.noNewline && <span className="text-zinc-600"> ↵ no newline at end of file</span>}
      </div>
    </>
  );
}

function rowThreads(threads: FileThreads, row: DiffRow) {
  const keys: string[] = [];
  if (row.new?.newLine != null) keys.push(anchorKey("RIGHT", row.new.newLine));
  if (row.old?.oldLine != null) keys.push(anchorKey("LEFT", row.old.oldLine));
  return keys.flatMap((key) => threads.byAnchor.get(key) ?? []);
}

function HunkRows({
  path,
  hunk,
  threads,
}: {
  path: string;
  hunk: DiffHunk;
  threads: FileThreads;
}) {
  const rows: DiffRow[] = buildSideBySideRows(hunk);
  return (
    <>
      <div className="col-span-4 bg-zinc-800/60 px-2 py-0.5 text-zinc-500">
        {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
        {hunk.header && ` ${hunk.header}`}
      </div>
      {rows.map((row, index) => {
        const anchored = rowThreads(threads, row);
        return (
          <Fragment key={index}>
            <SideCell path={path} side="old" line={row.old} />
            <SideCell path={path} side="new" line={row.new} />
            {anchored.length > 0 && (
              <div className="col-span-4 space-y-2 border-y border-zinc-800 bg-zinc-950/80 px-3 py-2">
                {anchored.map((thread) => (
                  <ThreadCard key={thread.id} thread={thread} />
                ))}
              </div>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function DiffBody({ diff, threads }: { diff: FileDiff; threads: FileThreads }) {
  if (diff.kind === "binary") {
    return (
      <Message>
        Binary file — {formatBytes(diff.oldSize)} → {formatBytes(diff.newSize)}.
      </Message>
    );
  }
  if (diff.kind === "too-large") {
    return (
      <Message>
        File too large to diff — {formatBytes(diff.oldSize)} → {formatBytes(diff.newSize)}.
      </Message>
    );
  }
  if (diff.hunks.length === 0) {
    return <Message>{diff.oldPath ? "Renamed, with no content changes." : "No changes."}</Message>;
  }
  return (
    <div className="h-full overflow-auto">
      <OutdatedThreads threads={threads.outdated} />
      <div className="grid w-max min-w-full grid-cols-[auto_1fr_auto_1fr] font-mono text-xs leading-5">
        {diff.hunks.map((hunk) => (
          <HunkRows
            key={`${hunk.oldStart}-${hunk.newStart}`}
            path={diff.path}
            hunk={hunk}
            threads={threads}
          />
        ))}
      </div>
    </div>
  );
}

export function DiffViewer({ sessionId, path }: { sessionId: string; path: string }) {
  const { data, error, isLoading } = useFileDiff(sessionId, path);
  const threads = usePrThreads(sessionId, path);

  return (
    <div className="h-full bg-zinc-900">
      {isLoading ? (
        <Message>Loading…</Message>
      ) : error ? (
        <Message>{(error as Error).message}</Message>
      ) : data ? (
        <DiffBody diff={data} threads={threads} />
      ) : null}
    </div>
  );
}

export function DiffPanelHeader({
  sessionId,
  path,
  onClose,
}: {
  sessionId: string;
  path: string;
  onClose: () => void;
}) {
  const { data } = useFileDiff(sessionId, path);
  const label = data?.oldPath ? `${data.oldPath} → ${path}` : path;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-[10px] text-zinc-500" title={label}>
        {label}
      </span>
      <button
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onClose}
        title="Close the diff"
        className="shrink-0 rounded px-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        ✕
      </button>
    </div>
  );
}
