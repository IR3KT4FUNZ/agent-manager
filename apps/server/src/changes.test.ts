import { afterAll, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorktreeInfo } from "@agent-manager/shared";
import { getFileDiff, listChanges } from "./changes";
import { removeTempDirs, tempRepo } from "./testRepo";
import { runGit } from "./worktrees";

afterAll(removeTempDirs);

// A worktree standing in for a session's: tests diff a plain repo directly, so
// nothing lands in the real `~/agent-manager/workspaces`.
async function repoWorktree(): Promise<WorktreeInfo> {
  const path = await tempRepo();
  return { path, branch: "main", repoRoot: path };
}

test("a modified file reports its added and removed lines", async () => {
  const worktree = await repoWorktree();
  writeFileSync(join(worktree.path, "README.md"), "hello there\nand again\n");

  const diff = await getFileDiff(worktree, "README.md");

  expect(diff).toMatchObject({ status: "modified", kind: "text", additions: 2, deletions: 1 });
  expect(diff.hunks[0]!.lines).toEqual([
    { kind: "del", text: "hello", oldLine: 1, newLine: null },
    { kind: "add", text: "hello there", oldLine: null, newLine: 1 },
    { kind: "add", text: "and again", oldLine: null, newLine: 2 },
  ]);
});

test("an untracked file diffs as an all-new file", async () => {
  const worktree = await repoWorktree();
  writeFileSync(join(worktree.path, "notes.txt"), "one\ntwo\n");

  const diff = await getFileDiff(worktree, "notes.txt");

  expect(diff).toMatchObject({ status: "untracked", kind: "text", additions: 2, deletions: 0 });
  expect(diff.hunks[0]!.lines.map((line) => line.text)).toEqual(["one", "two"]);
});

test("a deleted file diffs as all removals", async () => {
  const worktree = await repoWorktree();
  rmSync(join(worktree.path, "README.md"));

  const diff = await getFileDiff(worktree, "README.md");

  expect(diff).toMatchObject({ status: "deleted", additions: 0, deletions: 1, newSize: 0 });
});

test("a rename carries the old path and no content changes", async () => {
  const worktree = await repoWorktree();
  await runGit(["mv", "README.md", "GUIDE.md"], worktree.path);

  const { files } = await listChanges(worktree);
  const diff = await getFileDiff(worktree, "GUIDE.md");

  expect(files).toEqual([{ path: "GUIDE.md", oldPath: "README.md", status: "renamed" }]);
  expect(diff).toMatchObject({ oldPath: "README.md", kind: "text", hunks: [] });
});

test("a binary file is reported with its sizes instead of hunks", async () => {
  const worktree = await repoWorktree();
  writeFileSync(join(worktree.path, "logo.png"), new Uint8Array([0x89, 0x50, 0x00, 0x01, 0x00]));

  const diff = await getFileDiff(worktree, "logo.png");

  expect(diff).toMatchObject({ kind: "binary", hunks: [], oldSize: 0, newSize: 5 });
});

test("a file over the size limit is not diffed", async () => {
  const worktree = await repoWorktree();
  writeFileSync(join(worktree.path, "big.txt"), "x".repeat(1024 * 1024 + 1));

  const diff = await getFileDiff(worktree, "big.txt");

  expect(diff).toMatchObject({ kind: "too-large", hunks: [] });
});

test("a path with no pending change is rejected", async () => {
  const worktree = await repoWorktree();

  expect(getFileDiff(worktree, "README.md")).rejects.toThrow("No pending change");
});
