import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PrReviewEvent, PrStatus } from "@agent-manager/shared";
import { submitPrReview } from "../lib/api";
import type { DraftAction, DraftComment, ReviewDraft } from "../lib/prReviewDraft";

const VERDICTS: { event: PrReviewEvent; label: string }[] = [
  { event: "COMMENT", label: "Comment" },
  { event: "APPROVE", label: "Approve" },
  { event: "REQUEST_CHANGES", label: "Request changes" },
];

export function CommentComposer({
  lines,
  onSave,
  onCancel,
}: {
  lines: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) onSave(body.trim());
      }}
      className="space-y-1.5 rounded-md border border-sky-500/40 bg-zinc-900 p-2"
    >
      <p className="text-[10px] text-zinc-500">Comment on {lines}</p>
      <textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Leave a comment"
        className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-sans text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!body.trim()}
          className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          Add to review
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function DraftCard({
  comment,
  onRemove,
}: {
  comment: DraftComment;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-sky-500/40 bg-sky-500/5 px-2 py-1.5">
      <p className="flex items-baseline gap-2 text-[10px] text-zinc-500">
        <span className="font-medium text-sky-300">Pending</span>
        <span className="min-w-0 flex-1 truncate">{describeAnchor(comment)}</span>
        <button onClick={onRemove} title="Remove this comment" className="hover:text-rose-400">
          ✕
        </button>
      </p>
      <p className="mt-0.5 font-sans text-xs whitespace-pre-wrap text-zinc-200">{comment.body}</p>
    </div>
  );
}

export function describeAnchor(comment: DraftComment): string {
  const side = comment.side === "LEFT" ? "old" : "new";
  const lines =
    comment.startLine && comment.startLine < comment.line
      ? `${comment.startLine}–${comment.line}`
      : `${comment.line}`;
  return `${comment.path}:${lines} (${side})`;
}

export function ReviewDrawer({
  sessionId,
  status,
  draft,
  dispatch,
}: {
  sessionId: string;
  status: PrStatus;
  draft: ReviewDraft;
  dispatch: (action: DraftAction) => void;
}) {
  const queryClient = useQueryClient();
  const [event, setEvent] = useState<PrReviewEvent>("COMMENT");

  const submit = useMutation({
    mutationFn: () =>
      submitPrReview(sessionId, {
        event,
        body: draft.body,
        comments: draft.comments.map(({ id: _id, ...comment }) => comment),
        allowStale: status.remoteAdvanced,
      }),
    onSuccess: () => {
      dispatch({ type: "clear" });
      for (const key of ["pr-comments", "session-pr"]) {
        queryClient.invalidateQueries({ queryKey: [key, sessionId] });
      }
    },
  });

  const count = draft.comments.length;

  return (
    <details className="shrink-0 border-t border-zinc-800 bg-zinc-900" open={count > 0}>
      <summary className="cursor-pointer px-3 py-1.5 text-xs text-zinc-400">
        Review · {count === 0 ? "no comments yet" : `${count} pending`}
      </summary>

      <div className="space-y-2 px-3 pt-1 pb-3">
        {count > 0 && (
          <div className="max-h-36 space-y-1.5 overflow-y-auto">
            {draft.comments.map((comment) => (
              <DraftCard
                key={comment.id}
                comment={comment}
                onRemove={() => dispatch({ type: "remove", id: comment.id })}
              />
            ))}
          </div>
        )}

        <textarea
          rows={2}
          value={draft.body}
          onChange={(changed) => dispatch({ type: "summary", body: changed.target.value })}
          placeholder="Review summary (optional)"
          className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-sans text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
        />

        <div className="flex items-center gap-2">
          <select
            value={event}
            onChange={(changed) => setEvent(changed.target.value as PrReviewEvent)}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none"
          >
            {VERDICTS.map((verdict) => (
              <option key={verdict.event} value={verdict.event}>
                {verdict.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
            className="rounded-md bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          >
            {submit.isPending
              ? "Submitting…"
              : status.remoteAdvanced
                ? "Submit anyway"
                : "Submit review"}
          </button>
        </div>

        {status.remoteAdvanced && (
          <p className="text-[10px] text-amber-300">
            The PR head moved on GitHub. These comments will anchor to the head you reviewed.
          </p>
        )}
        {submit.error && <p className="text-xs text-rose-400">{(submit.error as Error).message}</p>}
      </div>
    </details>
  );
}
