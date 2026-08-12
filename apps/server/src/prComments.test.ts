import { expect, test } from "bun:test";
import { join } from "node:path";
import { groupThreads, type RawReviewComment } from "./prComments";

const comments = (await Bun.file(
  join(import.meta.dir, "fixtures", "prComments.json"),
).json()) as RawReviewComment[];

test("review comments group into threads by their root comment", () => {
  const threads = groupThreads(comments);

  expect(threads.map((thread) => [thread.id, thread.comments.length])).toEqual([
    [104, 1],
    [101, 3],
    [105, 1],
  ]);

  const [outdated, discussion, multiLine] = threads;
  expect(discussion).toMatchObject({
    path: "apps/server/src/github.ts",
    line: 12,
    side: "RIGHT",
    outdated: false,
  });
  // A reply to a reply still belongs to the thread it started in.
  expect(discussion?.comments.map((comment) => comment.author)).toEqual([
    "reviewer",
    "author",
    "reviewer",
  ]);
  expect(multiLine).toMatchObject({ path: "README.md", line: 30, startLine: 28, side: "LEFT" });
  expect(outdated).toMatchObject({ line: null, outdated: true });
});
