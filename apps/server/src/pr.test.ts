import { afterAll, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PrAssociation } from "@agent-manager/shared";
import { listChanges } from "./changes";
import {
  checkoutPrWorktree,
  loadPrStatus,
  prFetchRef,
  resolvePrAssociation,
  syncWorktreeToPrHead,
} from "./pr";
import { stubGh, useStubGh } from "./testGh";
import {
  pushToPullRequest,
  removeTempDirs,
  tempDir,
  tempRepoWithPullRequest,
} from "./testRepo";
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

async function repoWithPullRequest(): Promise<{ repo: string; headSha: string }> {
  const fixture = await tempRepoWithPullRequest();
  workspaceRoots.push(join(homedir(), "agent-manager", "workspaces", basename(fixture.repo)));
  return fixture;
}

function remoteHeadStub(headSha: string) {
  return stubGh(`echo '{"headRefOid":"${headSha}"}'`);
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

test("PR status is clean at the PR head, then flags what the worktree changed", async () => {
  const { repo, headSha } = await repoWithPullRequest();
  const pr = association({ headSha });
  const worktree = await checkoutPrWorktree(repo, pr);
  const stub = remoteHeadStub(headSha);
  const restore = useStubGh(stub);

  try {
    const clean = await loadPrStatus(worktree, pr, undefined);
    expect(clean.status).toEqual({
      pr,
      localDirty: false,
      localAhead: false,
      remoteAdvanced: false,
      remoteHeadSha: headSha,
      modifiedSinceHead: [],
    });

    writeFileSync(join(worktree.path, "widget.txt"), "edited\n");
    writeFileSync(join(worktree.path, "notes.md"), "notes\n");

    const edited = await loadPrStatus(worktree, pr, clean.lookup);
    expect(edited.status).toMatchObject({
      localDirty: true,
      localAhead: false,
      modifiedSinceHead: ["notes.md", "widget.txt"],
    });
    expect(stub.calls()).toHaveLength(1); // the second load reused the cached lookup
  } finally {
    restore();
  }
});

test("a PR head that moved on GitHub shows as advanced, and syncing lands on it", async () => {
  const { repo, headSha } = await repoWithPullRequest();
  const pr = association({ headSha });
  const worktree = await checkoutPrWorktree(repo, pr);
  const pushedSha = await pushToPullRequest(repo, "extra.txt");
  const restore = useStubGh(remoteHeadStub(pushedSha));

  try {
    const { status } = await loadPrStatus(worktree, pr, undefined);
    expect(status).toMatchObject({ remoteAdvanced: true, remoteHeadSha: pushedSha });

    expect(await syncWorktreeToPrHead(worktree, pr)).toBe(pushedSha);
    expect((await runGit(["rev-parse", "HEAD"], worktree.path)).stdout).toBe(pushedSha);
  } finally {
    restore();
  }
});
