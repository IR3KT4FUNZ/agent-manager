import { afterAll, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PrAssociation } from "@agent-manager/shared";
import { listChanges } from "./changes";
import { checkoutPrWorktree, prFetchRef, resolvePrAssociation } from "./pr";
import { stubGh, useStubGh } from "./testGh";
import { commitAll, removeTempDirs, tempDir, tempRepo } from "./testRepo";
import { runGit } from "./worktrees";

const workspaceRoots: string[] = [];

afterAll(() => {
  for (const dir of workspaceRoots) rmSync(dir, { recursive: true, force: true });
  removeTempDirs();
});

const PR_VIEW_JSON = JSON.stringify({
  number: 42,
  title: "Add widgets",
  state: "OPEN",
  isDraft: false,
  url: "https://github.com/octo/repo/pull/42",
  baseRefName: "main",
  headRefName: "feature",
  headRefOid: "abc123",
  isCrossRepository: true,
  author: { login: "contributor" },
});

function ghStub() {
  return stubGh(
    [
      'case "$1 $2" in',
      `  "repo view") echo '{"nameWithOwner":"octo/repo"}' ;;`,
      `  "pr view") echo '${PR_VIEW_JSON}' ;;`,
      "esac",
    ].join("\n"),
  );
}

// A local "origin" carrying refs/pull/1/head, exactly like GitHub serves it.
async function repoWithPullRequest(): Promise<{ repo: string; headSha: string }> {
  const origin = tempDir("agent-manager-origin-");
  await runGit(["init", "--bare", "-b", "main"], origin);

  const repo = await tempRepo();
  workspaceRoots.push(join(homedir(), "agent-manager", "workspaces", basename(repo)));
  await runGit(["remote", "add", "origin", origin], repo);
  await runGit(["push", "origin", "main"], repo);

  await runGit(["checkout", "-b", "feature"], repo);
  writeFileSync(join(repo, "widget.txt"), "widget\n");
  await commitAll(repo, "add a widget");
  const headSha = (await runGit(["rev-parse", "HEAD"], repo)).stdout;
  await runGit(["push", "origin", "HEAD:refs/pull/1/head"], repo);

  // Leave the local repo as a plain checkout of main: the PR only exists on origin.
  await runGit(["checkout", "main"], repo);
  await runGit(["branch", "-D", "feature"], repo);
  return { repo, headSha };
}

function association(overrides: Partial<PrAssociation> = {}): PrAssociation {
  return {
    number: 1,
    title: "Add a widget",
    url: "https://example.invalid/pull/1",
    state: "OPEN",
    isDraft: false,
    baseRepo: "octo/repo",
    baseRefName: "main",
    headRefName: "feature",
    headSha: "",
    isCrossRepository: false,
    author: "contributor",
    ...overrides,
  };
}

test("resolvePrAssociation maps gh output onto the session's PR", async () => {
  const restore = useStubGh(ghStub());
  try {
    expect(await resolvePrAssociation(tempDir("agent-manager-cwd-"), "#42")).toEqual({
      number: 42,
      title: "Add widgets",
      url: "https://github.com/octo/repo/pull/42",
      state: "OPEN",
      isDraft: false,
      baseRepo: "octo/repo",
      baseRefName: "main",
      headRefName: "feature",
      headSha: "abc123",
      isCrossRepository: true,
      author: "contributor",
    });
  } finally {
    restore();
  }
});

test("resolvePrAssociation rejects a URL from a different repository", async () => {
  const restore = useStubGh(ghStub());
  try {
    await expect(
      resolvePrAssociation(tempDir("agent-manager-cwd-"), "https://github.com/other/repo/pull/42"),
    ).rejects.toThrow(/belongs to other\/repo/);
  } finally {
    restore();
  }
});

test("checking out a PR builds a worktree at the PR head that diffs against its base", async () => {
  const { repo, headSha } = await repoWithPullRequest();

  const worktree = await checkoutPrWorktree(repo, association({ headSha }));

  expect(worktree.branch).toBe("pr-1-feature");
  expect((await runGit(["rev-parse", "HEAD"], worktree.path)).stdout).toBe(headSha);
  expect((await runGit(["rev-parse", prFetchRef(1)], repo)).stdout).toBe(headSha);
  expect((await runGit(["rev-parse", "--verify", "origin/main"], repo)).exitCode).toBe(0);

  expect(await listChanges(worktree, "origin/main")).toEqual({
    base: "origin/main",
    files: [{ path: "widget.txt", status: "added" }],
  });
});
