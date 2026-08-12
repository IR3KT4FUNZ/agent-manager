import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DiffHunk, DiffLine, FileDiff, PrSide } from "@agent-manager/shared";
import { buildSideBySideRows, type DiffRow } from "../lib/diffRows";
import { getFileDiff } from "../lib/api";
import { draftStorageKey, usePrReviewDraft, type DraftComment } from "../lib/prReviewDraft";
import { CommentComposer, DraftCard, ReviewDrawer } from "./PrReview";
import { useSessionPr } from "./PrStatus";
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

interface Anchor {
  side: PrSide;
  line: number;
  startLine?: number;
}

interface Review {
  sessionId: string;
  threads: FileThreads;
  drafts: Map<string, DraftComment[]>;
  composer: Anchor | null;
  drag: { side: PrSide; from: number; to: number } | null;
  commenting: boolean;
  start: (anchor: Anchor) => void;
  extend: (anchor: Anchor) => void;
  save: (body: string) => void;
  cancel: () => void;
  remove: (id: string) => void;
}

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

function describeLines(anchor: Anchor): string {
  const side = anchor.side === "LEFT" ? "old" : "new";
  return anchor.startLine && anchor.startLine < anchor.line
    ? `lines ${anchor.startLine}–${anchor.line} (${side})`
    : `line ${anchor.line} (${side})`;
}

function Message({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-xs text-zinc-500">{children}</p>;
}

function inDrag(review: Review, side: PrSide, line: number): boolean {
  const { drag } = review;
  if (!drag || drag.side !== side) return false;
  return line >= Math.min(drag.from, drag.to) && line <= Math.max(drag.from, drag.to);
}

function SideCell({
  path,
  side,
  line,
  review,
}: {
  path: string;
  side: "old" | "new";
  line: DiffLine | null;
  review: Review;
}) {
  const number = side === "old" ? (line?.oldLine ?? null) : (line?.newLine ?? null);
  const tint = line ? SIDE_TINT[line.kind] : SIDE_TINT.empty;
  const prSide: PrSide = side === "old" ? "LEFT" : "RIGHT";
  const selected = number !== null && inDrag(review, prSide, number);

  return (
    <>
      <div
        className={`shrink-0 text-right tabular-nums text-zinc-600 select-none ${
          selected ? "bg-sky-500/30" : tint.background
        }`}
        aria-hidden
      >
        {review.commenting && number !== null ? (
          <button
            onPointerDown={(event) => {
              event.preventDefault();
              review.start({ side: prSide, line: number });
            }}
            onPointerEnter={() => review.extend({ side: prSide, line: number })}
            title="Comment on this line — drag for a range"
            className="group w-full px-2 text-right hover:text-sky-300"
          >
            <span className="group-hover:hidden">{number}</span>
            <span className="hidden group-hover:inline">+</span>
          </button>
        ) : (
          <span className="block px-2">{number ?? ""}</span>
        )}
      </div>
      <div
        data-path={path}
        data-side={side}
        data-line={number ?? undefined}
        className={`px-2 whitespace-pre ${selected ? "bg-sky-500/20" : tint.background} ${tint.text}`}
      >
        {line?.text ?? ""}
        {line?.noNewline && <span className="text-zinc-600"> ↵ no newline at end of file</span>}
      </div>
    </>
  );
}

function rowAnchors(row: DiffRow): Anchor[] {
  const anchors: Anchor[] = [];
  if (row.old?.oldLine != null) anchors.push({ side: "LEFT", line: row.old.oldLine });
  if (row.new?.newLine != null) anchors.push({ side: "RIGHT", line: row.new.newLine });
  return anchors;
}

function RowNotes({ row, review }: { row: DiffRow; review: Review }) {
  const anchors = rowAnchors(row);
  const threads = anchors.flatMap(
    (anchor) => review.threads.byAnchor.get(anchorKey(anchor.side, anchor.line)) ?? [],
  );
  const drafts = anchors.flatMap(
    (anchor) => review.drafts.get(anchorKey(anchor.side, anchor.line)) ?? [],
  );
  const composer =
    review.composer &&
    anchors.some(
      (anchor) => anchor.side === review.composer?.side && anchor.line === review.composer.line,
    )
      ? review.composer
      : null;

  if (threads.length === 0 && drafts.length === 0 && !composer) return null;

  return (
    <div className="col-span-4 space-y-2 border-y border-zinc-800 bg-zinc-950/80 px-3 py-2">
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} sessionId={review.sessionId} />
      ))}
      {drafts.map((draft) => (
        <DraftCard key={draft.id} comment={draft} onRemove={() => review.remove(draft.id)} />
      ))}
      {composer && (
        <CommentComposer
          lines={describeLines(composer)}
          onSave={review.save}
          onCancel={review.cancel}
        />
      )}
    </div>
  );
}

function HunkRows({ path, hunk, review }: { path: string; hunk: DiffHunk; review: Review }) {
  const rows: DiffRow[] = buildSideBySideRows(hunk);
  return (
    <>
      <div className="col-span-4 bg-zinc-800/60 px-2 py-0.5 text-zinc-500">
        {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
        {hunk.header && ` ${hunk.header}`}
      </div>
      {rows.map((row, index) => (
        <Fragment key={index}>
          <SideCell path={path} side="old" line={row.old} review={review} />
          <SideCell path={path} side="new" line={row.new} review={review} />
          <RowNotes row={row} review={review} />
        </Fragment>
      ))}
    </>
  );
}

function DiffBody({ diff, review }: { diff: FileDiff; review: Review }) {
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
      <OutdatedThreads threads={review.threads.outdated} sessionId={review.sessionId} />
      <div className="grid w-max min-w-full grid-cols-[auto_1fr_auto_1fr] font-mono text-xs leading-5">
        {diff.hunks.map((hunk) => (
          <HunkRows
            key={`${hunk.oldStart}-${hunk.newStart}`}
            path={diff.path}
            hunk={hunk}
            review={review}
          />
        ))}
      </div>
    </div>
  );
}

export function DiffViewer({ sessionId, path }: { sessionId: string; path: string }) {
  const { data, error, isLoading } = useFileDiff(sessionId, path);
  const threads = usePrThreads(sessionId, path);
  const { data: status } = useSessionPr(sessionId);

  const pr = status?.pr ?? null;
  const editedSinceHead = status?.modifiedSinceHead.includes(path) ?? false;
  const { draft, dispatch } = usePrReviewDraft(
    pr ? draftStorageKey(pr.baseRepo, pr.number) : null,
  );

  const [drag, setDrag] = useState<{ side: PrSide; from: number; to: number } | null>(null);
  const [composer, setComposer] = useState<Anchor | null>(null);

  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      setComposer({
        side: drag.side,
        line: Math.max(drag.from, drag.to),
        startLine: drag.from === drag.to ? undefined : Math.min(drag.from, drag.to),
      });
      setDrag(null);
    };
    window.addEventListener("pointerup", finish);
    return () => window.removeEventListener("pointerup", finish);
  }, [drag]);

  const drafts = new Map<string, DraftComment[]>();
  for (const comment of draft.comments) {
    if (comment.path !== path) continue;
    const key = anchorKey(comment.side, comment.line);
    drafts.set(key, [...(drafts.get(key) ?? []), comment]);
  }

  const review: Review = {
    sessionId,
    threads,
    drafts,
    composer,
    drag,
    commenting: Boolean(pr) && !editedSinceHead,
    start: (anchor) => setDrag({ side: anchor.side, from: anchor.line, to: anchor.line }),
    extend: (anchor) =>
      setDrag((current) =>
        current && current.side === anchor.side ? { ...current, to: anchor.line } : current,
      ),
    save: (body) => {
      if (composer) dispatch({ type: "add", comment: { ...composer, path, body } });
      setComposer(null);
    },
    cancel: () => setComposer(null),
    remove: (id) => dispatch({ type: "remove", id }),
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-900">
      {pr && editedSinceHead && (
        <p className="shrink-0 border-b border-zinc-800 px-3 py-1.5 text-[10px] text-amber-300">
          This file has changed since the PR head, so commenting is off — its lines no longer match
          what GitHub would anchor to.
        </p>
      )}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <Message>Loading…</Message>
        ) : error ? (
          <Message>{(error as Error).message}</Message>
        ) : data ? (
          <DiffBody diff={data} review={review} />
        ) : null}
      </div>
      {status?.pr && (
        <ReviewDrawer
          sessionId={sessionId}
          status={status}
          draft={draft}
          dispatch={dispatch}
        />
      )}
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
