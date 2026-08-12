import { useCallback, useEffect, useState } from "react";
import type { PrDraftComment } from "@agent-manager/shared";

export interface DraftComment extends PrDraftComment {
  id: string;
}

export interface ReviewDraft {
  body: string;
  comments: DraftComment[];
}

export type DraftAction =
  | { type: "add"; comment: Omit<DraftComment, "id"> }
  | { type: "remove"; id: string }
  | { type: "summary"; body: string }
  | { type: "clear" };

export const EMPTY_DRAFT: ReviewDraft = { body: "", comments: [] };

export function draftStorageKey(baseRepo: string, number: number): string {
  return `agent-manager.pr-draft.${baseRepo}#${number}`;
}

function commentId(comment: Omit<DraftComment, "id">): string {
  return `${comment.path}:${comment.side}:${comment.startLine ?? comment.line}-${comment.line}`;
}

export function draftReducer(draft: ReviewDraft, action: DraftAction): ReviewDraft {
  switch (action.type) {
    case "add": {
      const comment = { ...action.comment, id: commentId(action.comment) };
      const others = draft.comments.filter((existing) => existing.id !== comment.id);
      return { ...draft, comments: [...others, comment] };
    }
    case "remove":
      return { ...draft, comments: draft.comments.filter((c) => c.id !== action.id) };
    case "summary":
      return { ...draft, body: action.body };
    case "clear":
      return EMPTY_DRAFT;
  }
}

export function sanitizeDraft(value: unknown): ReviewDraft {
  if (typeof value !== "object" || value === null) return EMPTY_DRAFT;
  const { body, comments } = value as Partial<ReviewDraft>;
  return {
    body: typeof body === "string" ? body : "",
    comments: Array.isArray(comments)
      ? comments.filter(
          (comment): comment is DraftComment =>
            typeof comment?.id === "string" &&
            typeof comment.path === "string" &&
            typeof comment.body === "string" &&
            Number.isInteger(comment.line),
        )
      : [],
  };
}

function loadDraft(key: string | null): ReviewDraft {
  if (!key) return EMPTY_DRAFT;
  try {
    const raw = localStorage.getItem(key);
    return sanitizeDraft(raw ? JSON.parse(raw) : null);
  } catch {
    return EMPTY_DRAFT;
  }
}

// Drafts outlive the app's in-memory sessions, so an interrupted review is
// still there after a restart. They are cleared once GitHub has the review.
export function usePrReviewDraft(key: string | null) {
  const [draft, setDraft] = useState<ReviewDraft>(() => loadDraft(key));

  useEffect(() => setDraft(loadDraft(key)), [key]);

  useEffect(() => {
    if (!key) return;
    try {
      if (draft.comments.length === 0 && draft.body === "") localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(draft));
    } catch {}
  }, [key, draft]);

  const dispatch = useCallback(
    (action: DraftAction) => setDraft((current) => draftReducer(current, action)),
    [],
  );

  return { draft, dispatch };
}
