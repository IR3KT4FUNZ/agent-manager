import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { PrAssociation } from "@agent-manager/shared";
import {
  buildReviewPayload,
  groupThreads,
  submitPrReview,
  type RawReviewComment,
} from "./prComments";
import { stubGh, useStubGh } from "./testGh";
import { removeTempDirs, tempDir } from "./testRepo";

afterAll(removeTempDirs);

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

const pr = {
  number: 7,
  baseRepo: "octo/repo",
  headSha: "deadbeef",
} as PrAssociation;

test("a review payload anchors comments with line/side and carries the reviewed head", () => {
  expect(
    buildReviewPayload(pr.headSha, {
      event: "REQUEST_CHANGES",
      body: "  A couple of things.  ",
      comments: [
        { path: "a.ts", line: 12, side: "RIGHT", body: "Extract this." },
        { path: "b.ts", line: 30, startLine: 28, side: "LEFT", body: "Stale block." },
      ],
    }),
  ).toEqual({
    commit_id: "deadbeef",
    event: "REQUEST_CHANGES",
    body: "A couple of things.",
    comments: [
      { path: "a.ts", line: 12, side: "RIGHT", body: "Extract this." },
      {
        path: "b.ts",
        line: 30,
        side: "LEFT",
        start_line: 28,
        start_side: "LEFT",
        body: "Stale block.",
      },
    ],
  });
});

test("a review needs something to say, unless it is a plain approval", () => {
  expect(() => buildReviewPayload("sha", { event: "COMMENT", comments: [] })).toThrow(
    /before submitting/,
  );
  expect(buildReviewPayload("sha", { event: "APPROVE", comments: [] })).toEqual({
    commit_id: "sha",
    event: "APPROVE",
    comments: [],
  });
});

test("submitting posts the review to GitHub as one request on stdin", async () => {
  const stub = stubGh("echo '{\"id\":1}'");
  const restore = useStubGh(stub);
  try {
    await submitPrReview(tempDir("agent-manager-cwd-"), pr, {
      event: "APPROVE",
      body: "Ship it.",
      comments: [],
    });
    expect(stub.calls()).toEqual([
      ["api", "repos/octo/repo/pulls/7/reviews", "--method", "POST", "--input", "-"],
    ]);
    expect(JSON.parse(stub.stdin())).toEqual({
      commit_id: "deadbeef",
      event: "APPROVE",
      body: "Ship it.",
      comments: [],
    });
  } finally {
    restore();
  }
});
