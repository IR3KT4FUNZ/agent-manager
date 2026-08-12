import { describe, expect, test } from "bun:test";
import {
  draftReducer,
  draftStorageKey,
  EMPTY_DRAFT,
  sanitizeDraft,
  type ReviewDraft,
} from "./prReviewDraft";

const comment = { path: "a.ts", line: 12, side: "RIGHT" as const, body: "Extract this." };

describe("draftReducer", () => {
  test("adds comments, replaces one already anchored to the same lines, and removes by id", () => {
    const added = draftReducer(EMPTY_DRAFT, { type: "add", comment });
    expect(added.comments).toHaveLength(1);

    const rewritten = draftReducer(added, {
      type: "add",
      comment: { ...comment, body: "Second thought." },
    });
    expect(rewritten.comments).toHaveLength(1);
    expect(rewritten.comments[0]?.body).toBe("Second thought.");

    const ranged = draftReducer(rewritten, {
      type: "add",
      comment: { ...comment, startLine: 10, body: "The whole block." },
    });
    expect(ranged.comments).toHaveLength(2);

    const id = ranged.comments[0]!.id;
    expect(draftReducer(ranged, { type: "remove", id }).comments.map((c) => c.id)).not.toContain(
      id,
    );
  });

  test("keeps the summary separate and clears everything at once", () => {
    const withSummary = draftReducer(EMPTY_DRAFT, {
      type: "summary",
      body: "Looks good overall.",
    });
    expect(withSummary.body).toBe("Looks good overall.");
    expect(draftReducer(withSummary, { type: "clear" })).toEqual(EMPTY_DRAFT);
  });
});

test("a stored draft survives round-tripping, and junk falls back to empty", () => {
  const draft: ReviewDraft = draftReducer(
    draftReducer(EMPTY_DRAFT, { type: "add", comment }),
    { type: "summary", body: "Two notes." },
  );
  expect(sanitizeDraft(JSON.parse(JSON.stringify(draft)))).toEqual(draft);
  expect(sanitizeDraft({ body: 7, comments: [{ path: "a.ts" }] })).toEqual(EMPTY_DRAFT);
  expect(sanitizeDraft(null)).toEqual(EMPTY_DRAFT);
});

test("drafts are keyed per repository and pull request", () => {
  expect(draftStorageKey("octo/repo", 12)).toBe("agent-manager.pr-draft.octo/repo#12");
});
