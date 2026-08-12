import type { PrAssociation, PrReviewThread, PrSide } from "@agent-manager/shared";
import { runGhJson } from "./github";

export interface RawReviewComment {
  id: number;
  in_reply_to_id?: number;
  path: string;
  line: number | null;
  original_line?: number | null;
  start_line?: number | null;
  side?: string | null;
  body: string;
  created_at: string;
  html_url: string;
  user?: { login?: string };
}

function toSide(side?: string | null): PrSide {
  return side === "LEFT" ? "LEFT" : "RIGHT";
}

// GitHub reports `line: null` for a comment whose anchor no longer exists in the
// current diff — the thread is outdated and cannot be placed on a row.
export function groupThreads(comments: RawReviewComment[]): PrReviewThread[] {
  const threads = new Map<number, PrReviewThread>();
  const threadOf = new Map<number, number>();

  for (const comment of comments) {
    const rootId = comment.in_reply_to_id ? (threadOf.get(comment.in_reply_to_id) ?? comment.in_reply_to_id) : comment.id;
    threadOf.set(comment.id, rootId);

    const thread =
      threads.get(rootId) ??
      ({
        id: rootId,
        path: comment.path,
        line: comment.line ?? null,
        side: toSide(comment.side),
        startLine: comment.start_line ?? undefined,
        outdated: comment.line === null || comment.line === undefined,
        comments: [],
      } satisfies PrReviewThread);

    thread.comments.push({
      id: comment.id,
      author: comment.user?.login ?? "unknown",
      body: comment.body,
      createdAt: comment.created_at,
      url: comment.html_url,
    });
    threads.set(rootId, thread);
  }

  return [...threads.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0),
  );
}

export async function listPrThreads(
  repoRoot: string,
  pr: PrAssociation,
): Promise<PrReviewThread[]> {
  const comments = await runGhJson<RawReviewComment[]>(
    ["api", `repos/${pr.baseRepo}/pulls/${pr.number}/comments`, "--paginate"],
    repoRoot,
  );
  return groupThreads(comments);
}
