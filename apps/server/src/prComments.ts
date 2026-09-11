import type {
  PrAssociation,
  PrReviewThread,
  PrSide,
  SubmitReviewRequest,
} from "@agent-manager/shared";
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

export interface ReviewPayloadComment {
  path: string;
  line: number;
  side: PrSide;
  start_line?: number;
  start_side?: PrSide;
  body: string;
}

export interface ReviewPayload {
  commit_id: string;
  event: string;
  body?: string;
  comments: ReviewPayloadComment[];
}

// The modern review API anchors comments with line/side (never the legacy
// `position`), and takes the whole review in one request so GitHub sends one
// notification instead of one per comment.
export function buildReviewPayload(headSha: string, request: SubmitReviewRequest): ReviewPayload {
  const body = request.body?.trim() ?? "";
  const comments: ReviewPayloadComment[] = request.comments.map((comment) => ({
    path: comment.path,
    line: comment.line,
    side: comment.side,
    ...(comment.startLine !== undefined && comment.startLine < comment.line
      ? { start_line: comment.startLine, start_side: comment.startSide ?? comment.side }
      : {}),
    body: comment.body,
  }));

  if (comments.length === 0 && body === "" && request.event !== "APPROVE") {
    throw new Error("Write a summary or at least one comment before submitting a review.");
  }

  return {
    commit_id: headSha,
    event: request.event,
    ...(body === "" ? {} : { body }),
    comments,
  };
}

export async function submitPrReview(
  repoRoot: string,
  pr: PrAssociation,
  request: SubmitReviewRequest,
): Promise<void> {
  const payload = buildReviewPayload(pr.headSha, request);
  await runGhJson(
    ["api", `repos/${pr.baseRepo}/pulls/${pr.number}/reviews`, "--method", "POST", "--input", "-"],
    repoRoot,
    { stdin: JSON.stringify(payload) },
  );
}

// The reviews API cannot reply to an existing thread; replies go to the
// comments endpoint with in_reply_to.
export async function replyToPrComment(
  repoRoot: string,
  pr: PrAssociation,
  commentId: number,
  body: string,
): Promise<void> {
  if (!body.trim()) throw new Error("A reply cannot be empty.");
  await runGhJson(
    [
      "api",
      `repos/${pr.baseRepo}/pulls/${pr.number}/comments`,
      "-f",
      `body=${body}`,
      "-F",
      `in_reply_to=${commentId}`,
    ],
    repoRoot,
  );
}
