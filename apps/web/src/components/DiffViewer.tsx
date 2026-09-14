import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DiffHunk, DiffLine, FileDiff, PrSide } from "@agent-manager/shared";
import { buildSideBySideRows, type DiffRow } from "../lib/diffRows";
import type { CodeView } from "../lib/codeHistory";
import { getFileDiff, listSessions } from "../lib/api";
import { draftStorageKey, usePrReviewDraft, type DraftComment } from "../lib/prReviewDraft";
import { DraftCard, ReviewDrawer } from "./PrReview";
import { useSessionPr } from "./PrStatus";
import {
  anchorKey,
  OutdatedThreads,
  ThreadCard,
  usePrThreads,
  type FileThreads,
} from "./PrThreads";

import { useReview } from "../lib/review";
import { DiffComposer } from "./DiffComposer";
import {
  diffComposers,
  useDiffComposer,
  useReviewFocusRequest,
  type SelectionAnchor,
} from "../lib/diffComposer";
import {
  agentQuestionDisabledReason,
  githubCommentDisabledReason,
  isDiffAnchorVisible,
} from "../lib/diffComposerRules";
import { useDiffSelection, type DiffDrag } from "../lib/useDiffSelection";

const SIDE_TINT = {
  add: { background: "bg-emerald-500/10", text: "text-emerald-200" },
  del: { background: "bg-rose-500/10", text: "text-rose-200" },
  context: { background: "", text: "text-zinc-300" },
  empty: { background: "bg-zinc-950/60", text: "" },
} as const;

interface Review {
  sessionId: string;
  threads: FileThreads;
  drafts: Map<string, DraftComment[]>;
  composer: SelectionAnchor | null;
  drag: DiffDrag | null;
  highlight?: { side: "old" | "new"; line: number; endLine: number };
  start: (anchor: SelectionAnchor) => void;
  extend: (anchor: SelectionAnchor) => void;
  open: (anchor: SelectionAnchor) => void;
  composerContent: ReactNode;
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
  const highlighted = number !== null && review.highlight?.side === side &&
    number >= review.highlight.line && number <= review.highlight.endLine;
  const selected = number !== null && (inDrag(review, prSide, number) || highlighted);

  return (
    <>
      <div
        className={`shrink-0 text-right tabular-nums text-zinc-600 select-none ${
          selected ? "bg-sky-500/30" : tint.background
        }`}
      >
        {number !== null ? (
          <button
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              review.start({ side: prSide, line: number });
            }}
            onPointerEnter={() => review.extend({ side: prSide, line: number })}
            onClick={(event) => {
              if (event.detail === 0) review.open({ side: prSide, line: number });
            }}
            aria-label={`Ask about or comment on ${side} line ${number}`}
            title="Ask about or comment on this line — drag for a range"
            className="group flex h-full w-full items-start justify-end px-2 text-right hover:text-sky-300 focus-visible:text-sky-300"
          >
            <span className="group-hover:hidden group-focus-visible:hidden">{number}</span>
            <span className="hidden group-hover:inline group-focus-visible:inline">+</span>
          </button>
        ) : (
          <span className="block px-2">{number ?? ""}</span>
        )}
      </div>
      <div
        data-walkthrough-highlight={highlighted || undefined}
        data-path={path}
        data-side={side}
        data-line={number ?? undefined}
        className={`min-w-0 px-2 whitespace-pre-wrap wrap-anywhere ${selected ? "bg-sky-500/20" : tint.background} ${tint.text}`}
      >
        <span data-code-text>{line?.text ?? ""}</span>
        {line?.noNewline && <span className="text-zinc-600"> ↵ no newline at end of file</span>}
      </div>
    </>
  );
}

function rowAnchors(row: DiffRow): SelectionAnchor[] {
  const anchors: SelectionAnchor[] = [];
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
    <div className="col-span-4 min-w-0 space-y-2 border-y border-zinc-800 bg-zinc-950/80 px-3 py-2">
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} sessionId={review.sessionId} />
      ))}
      {drafts.map((draft) => (
        <DraftCard key={draft.id} comment={draft} onRemove={() => review.remove(draft.id)} />
      ))}
      {composer && review.composerContent}
    </div>
  );
}

function HunkRows({ path, hunk, review }: { path: string; hunk: DiffHunk; review: Review }) {
  const rows: DiffRow[] = buildSideBySideRows(hunk);
  return (
    <>
      <div className="col-span-4 min-w-0 bg-zinc-800/60 px-2 py-0.5 whitespace-pre-wrap wrap-anywhere text-zinc-500">
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

function DiffBody({
  diff,
  review,
  view,
  onSave,
}: {
  diff: FileDiff;
  review: Review;
  view?: CodeView;
  onSave?: (view: Partial<CodeView>) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const highlightValid = view?.walkthrough && view.baseVersion === diff.baseVersion && view.version === diff.currentVersion;
  const displayedReview: Review = {
    ...review,
    highlight: highlightValid && view.side && view.line && view.endLine
      ? { side: view.side, line: view.line, endLine: view.endLine } : undefined,
  };
  useEffect(() => {
    if (!highlightValid || !view?.line || !view.side) return;
    scroll.current?.querySelector(`[data-side="${view.side}"][data-line="${view.line}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [highlightValid, view?.line, view?.side]);
  useEffect(() => {
    if (scroll.current) {
      scroll.current.scrollTop = view?.scrollTop ?? 0;
      scroll.current.scrollLeft = view?.scrollLeft ?? 0;
      if (!view?.walkthrough && view?.side && view.line && view.endLine) {
        const start = scroll.current.querySelector(
          `[data-side="${view.side}"][data-line="${view.line}"] [data-code-text]`,
        )?.firstChild;
        const end = scroll.current.querySelector(
          `[data-side="${view.side}"][data-line="${view.endLine}"] [data-code-text]`,
        )?.firstChild;
        if (start && end) {
          const range = document.createRange();
          range.setStart(
            start,
            Math.min((view.column ?? 1) - 1, start.textContent?.length ?? 0),
          );
          range.setEnd(
            end,
            Math.min((view.endColumn ?? 1) - 1, end.textContent?.length ?? 0),
          );
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        }
      }
    }
  }, []);
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
        File too large to diff — {formatBytes(diff.oldSize)} →{" "}
        {formatBytes(diff.newSize)}.
      </Message>
    );
  }
  if (diff.hunks.length === 0) {
    return (
      <Message>
        {diff.oldPath ? "Renamed, with no content changes." : "No changes."}
      </Message>
    );
  }
  return (
    <div
      ref={scroll}
      data-current-version={diff.currentVersion}
      className="h-full overflow-auto"
      onScroll={(event) =>
        onSave?.({
          scrollTop: event.currentTarget.scrollTop,
          scrollLeft: event.currentTarget.scrollLeft,
        })
      }
    >
      <OutdatedThreads
        threads={review.threads.outdated}
        sessionId={review.sessionId}
      />
      <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] font-mono text-xs leading-5">
        {diff.hunks.map((hunk) => (
          <HunkRows
            key={`${hunk.oldStart}-${hunk.newStart}`}
            path={diff.path}
            hunk={hunk}
            review={displayedReview}
          />
        ))}
      </div>
    </div>
  );
}

export function DiffViewer({
  sessionId,
  path,
  view,
  onSave,
}: {
  sessionId: string;
  path: string;
  view?: CodeView;
  onSave?: (view: Partial<CodeView>) => void;
}) {
  const { data, error, isLoading } = useFileDiff(sessionId, path);
  const threads = usePrThreads(sessionId, path);
  const { data: status } = useSessionPr(sessionId);

  const pr = status?.pr ?? null;
  const editedSinceHead = data?.reviewAnchorsValid === undefined
    ? (status?.modifiedSinceHead.includes(path) ?? false)
    : !data.reviewAnchorsValid;
  const { draft, dispatch } = usePrReviewDraft(
    pr ? draftStorageKey(pr.baseRepo, pr.number) : null,
  );

  const { drag, startSelection, extendSelection, openSelection } = useDiffSelection(sessionId, path, data);
  const composerDraft = useDiffComposer(sessionId, path);
  const delivered = useReviewFocusRequest(sessionId);
  const composer = composerDraft?.anchor ?? null;
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
  const session = sessions?.find((item) => item.id === sessionId);
  const { data: reviewState } = useReview(sessionId);
  const agentDisabled = agentQuestionDisabledReason(session, reviewState?.selection);
  const githubDisabled = githubCommentDisabledReason({
    hasPr: Boolean(pr),
    diff: data,
    context: composerDraft?.context,
  });
  const showDetachedComposer = composerDraft && (
    error || isLoading || !isDiffAnchorVisible(data, composerDraft.anchor)
  );

  function addReviewComment(body: string) {
    if (githubDisabled || !composerDraft) return;
    dispatch({
      type: "add",
      comment: { ...composerDraft.anchor, path: composerDraft.path, body },
    });
    diffComposers.cancel(composerDraft.id);
  }

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
    start: startSelection,
    open: openSelection,
    extend: extendSelection,
    composerContent: composerDraft && (
      <DiffComposer
        draft={composerDraft}
        hasPr={Boolean(pr)}
        githubDisabled={githubDisabled}
        agentDisabled={agentDisabled}
        onReview={addReviewComment}
      />
    ),
    remove: (id) => dispatch({ type: "remove", id }),
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-900">
      {delivered > 0 && !composerDraft && (
        <p role="status" className="border-b border-zinc-800 px-3 py-1.5 text-xs text-sky-300">
          Question submitted to the review assistant. Follow its response in Walkthrough.
        </p>
      )}
      {pr && editedSinceHead && (
        <p className="shrink-0 border-b border-zinc-800 px-3 py-1.5 text-[10px] text-amber-300">
          This file has changed since the PR head, so GitHub comments are unavailable — its lines no longer match
          what GitHub would anchor to.
        </p>
      )}
      {showDetachedComposer && (
        <div className="max-h-[70%] overflow-auto border-b border-zinc-800 p-3">
          {review.composerContent}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <Message>Loading…</Message>
        ) : error ? (
          <Message>{(error as Error).message}</Message>
        ) : data ? (
          <DiffBody diff={data} review={review} view={view} onSave={onSave} />
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

export function DiffPathLabel({ sessionId, path }: { sessionId: string; path: string }) {
  const { data } = useFileDiff(sessionId, path);
  const label = data?.oldPath ? `${data.oldPath} → ${path}` : path;
  return <span className="truncate font-mono text-[10px] text-zinc-400" title={label}>{label}</span>;
}
