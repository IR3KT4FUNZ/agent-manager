import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PrReviewThread, PrSide } from "@agent-manager/shared";
import { getSessionPrComments } from "../lib/api";

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

export function ThreadCard({ thread }: { thread: PrReviewThread }) {
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
    </div>
  );
}

export function OutdatedThreads({ threads }: { threads: PrReviewThread[] }) {
  if (threads.length === 0) return null;
  return (
    <details className="border-b border-zinc-800 px-3 py-2">
      <summary className="cursor-pointer text-xs text-zinc-500">
        {threads.length} outdated {threads.length === 1 ? "thread" : "threads"} — the lines they
        were written on are no longer in this diff
      </summary>
      <div className="mt-2 space-y-2">
        {threads.map((thread) => (
          <ThreadCard key={thread.id} thread={thread} />
        ))}
      </div>
    </details>
  );
}
