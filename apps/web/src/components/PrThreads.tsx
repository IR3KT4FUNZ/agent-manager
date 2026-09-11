import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrReviewThread, PrSide } from "@agent-manager/shared";
import { getSessionPrComments, replyToPrComment } from "../lib/api";

export function anchorKey(side: PrSide, line: number): string {
  return `${side}:${line}`;
}

export interface FileThreads {
  byAnchor: Map<string, PrReviewThread[]>;
  outdated: PrReviewThread[];
}

export function usePrThreads(sessionId: string, path: string): FileThreads {
  const { data } = useQuery({
    queryKey: ["pr-comments", sessionId],
    queryFn: () => getSessionPrComments(sessionId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return useMemo(() => {
    const forFile = (data ?? []).filter((thread) => thread.path === path);
    const byAnchor = new Map<string, PrReviewThread[]>();
    for (const thread of forFile) {
      if (thread.line === null) continue;
      const key = anchorKey(thread.side, thread.line);
      byAnchor.set(key, [...(byAnchor.get(key) ?? []), thread]);
    }
    return { byAnchor, outdated: forFile.filter((thread) => thread.line === null) };
  }, [data, path]);
}

function when(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ReplyBox({ sessionId, thread }: { sessionId: string; thread: PrReviewThread }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(false);

  const reply = useMutation({
    mutationFn: () => replyToPrComment(sessionId, thread.comments.at(-1)?.id ?? thread.id, body),
    onSuccess: () => {
      setBody("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["pr-comments", sessionId] });
    },
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-200"
      >
        Reply
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) reply.mutate();
      }}
      className="space-y-1.5 p-2"
    >
      <textarea
        autoFocus
        rows={2}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Reply — posted to GitHub right away"
        className="w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-sans text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!body.trim() || reply.isPending}
          className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
        >
          {reply.isPending ? "Posting…" : "Reply"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Cancel
        </button>
        {reply.error && <span className="text-xs text-rose-400">{(reply.error as Error).message}</span>}
      </div>
    </form>
  );
}

export function ThreadCard({
  thread,
  sessionId,
}: {
  thread: PrReviewThread;
  sessionId?: string;
}) {
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900">
      {thread.startLine && (
        <p className="border-b border-zinc-800 px-2 py-1 text-[10px] text-zinc-500">
          Lines {thread.startLine}–{thread.line} · {thread.side === "LEFT" ? "old" : "new"}
        </p>
      )}
      {thread.comments.map((comment) => (
        <div key={comment.id} className="border-b border-zinc-800 px-2 py-1.5 last:border-b-0">
          <p className="flex items-baseline gap-2 text-[10px] text-zinc-500">
            <a
              href={comment.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-zinc-300 hover:underline"
            >
              {comment.author}
            </a>
            <span>{when(comment.createdAt)}</span>
          </p>
          <p className="mt-0.5 font-sans text-xs whitespace-pre-wrap text-zinc-200">
            {comment.body}
          </p>
        </div>
      ))}
      {sessionId && <ReplyBox sessionId={sessionId} thread={thread} />}
    </div>
  );
}

export function OutdatedThreads({
  threads,
  sessionId,
}: {
  threads: PrReviewThread[];
  sessionId: string;
}) {
  if (threads.length === 0) return null;
  return (
    <details className="border-b border-zinc-800 px-3 py-2">
      <summary className="cursor-pointer text-xs text-zinc-500">
        {threads.length} outdated {threads.length === 1 ? "thread" : "threads"} — the lines they
        were written on are no longer in this diff
      </summary>
      <div className="mt-2 space-y-2">
        {threads.map((thread) => (
          <ThreadCard key={thread.id} thread={thread} sessionId={sessionId} />
        ))}
      </div>
    </details>
  );
}
