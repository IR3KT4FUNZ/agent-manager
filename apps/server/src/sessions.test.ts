import { afterAll, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ProjectManager } from "./projects";
import { SessionManager } from "./sessions";
import { stubGh, useStubGh } from "./testGh";
import {
  pushToPullRequest,
  removeTempDirs,
  tempDir,
  tempRepo,
  tempRepoWithPullRequest,
} from "./testRepo";
import { branchExists } from "./worktrees";

const workspaceRoots: string[] = [];

async function openTempRepoProject(): Promise<{ repo: string; projects: ProjectManager }> {
  const repo = await tempRepo();
  workspaceRoots.push(join(homedir(), "agent-manager", "workspaces", basename(repo)));
  return { repo, projects: new ProjectManager() };
}

afterAll(() => {
  for (const dir of workspaceRoots) rmSync(dir, { recursive: true, force: true });
  removeTempDirs();
});

test("every session in a repo project runs in its own worktree", async () => {
  const { repo, projects } = await openTempRepoProject();
  const project = await projects.open(repo);
  const sessions = new SessionManager();

  const first = await sessions.create(project, { projectId: project.id, command: "cat" });
  const second = await sessions.create(project, { projectId: project.id, command: "cat" });

  expect(first.worktree?.branch).not.toBe(second.worktree?.branch);
  for (const session of [first, second]) {
    expect(session.projectId).toBe(project.id);
    expect(session.worktree?.repoRoot).toBe(repo);
    expect(session.cwd).toBe(session.worktree!.path);
    expect(existsSync(session.cwd)).toBe(true);
  }

  await sessions.disposeProject(project.id);
});

test("closing a project kills its sessions and removes their worktrees, keeping the branches", async () => {
  const { repo, projects } = await openTempRepoProject();
  const project = await projects.open(repo);
  const sessions = new SessionManager();
  const session = await sessions.create(project, { projectId: project.id, command: "cat" });
  const { path, branch } = session.worktree!;

  await sessions.disposeProject(project.id);

  expect(sessions.list()).toHaveLength(0);
  expect(existsSync(path)).toBe(false);
  expect(await branchExists(repo, branch)).toBe(true);
});

function ghStubForPullRequest(headSha: string, remoteSha: string = headSha) {
  const view = JSON.stringify({
    number: 1,
    title: "Add a widget",
    state: "OPEN",
    isDraft: false,
    url: "https://github.com/octo/repo/pull/1",
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: headSha,
    isCrossRepository: false,
    author: { login: "contributor" },
  });
  return stubGh(
    [
      'case "$*" in',
      `  "repo view --json nameWithOwner") echo '{"nameWithOwner":"octo/repo"}' ;;`,
      `  "pr view 1 --json headRefOid") echo '{"headRefOid":"${remoteSha}"}' ;;`,
      `  *) echo '${view}' ;;`,
      "esac",
    ].join("\n"),
  );
}

test("a pull request session runs on the PR head and refuses to sync over local work", async () => {
  const { repo, headSha } = await tempRepoWithPullRequest();
  workspaceRoots.push(join(homedir(), "agent-manager", "workspaces", basename(repo)));
  const project = await new ProjectManager().open(repo);
  const sessions = new SessionManager();
  const restore = useStubGh(ghStubForPullRequest(headSha));

  try {
    const session = await sessions.create(project, {
      projectId: project.id,
      command: "cat",
      prNumber: 1,
    });

    expect(session.title).toBe("#1 Add a widget");
    expect(session.worktree?.branch).toBe("pr-1-feature");
    expect(session.pr).toMatchObject({ number: 1, headSha, baseRefName: "main" });
    expect(session.diffBase()).toBe("origin/main");

    writeFileSync(join(session.cwd, "widget.txt"), "edited\n");
    expect((await session.prStatus()).localDirty).toBe(true);
    await expect(session.syncToPrHead()).rejects.toThrow(/local changes/);
  } finally {
    restore();
    await sessions.disposeProject(project.id);
  }
});

test("a review is refused once the PR head has moved, unless the reviewer insists", async () => {
  const { repo, headSha } = await tempRepoWithPullRequest();
  workspaceRoots.push(join(homedir(), "agent-manager", "workspaces", basename(repo)));
  const project = await new ProjectManager().open(repo);
  const sessions = new SessionManager();
  let restore = useStubGh(ghStubForPullRequest(headSha));

  try {
    const session = await sessions.create(project, {
      projectId: project.id,
      command: "cat",
      prNumber: 1,
    });

    const pushedSha = await pushToPullRequest(repo, "extra.txt");
    restore();
    const stub = ghStubForPullRequest(headSha, pushedSha);
    restore = useStubGh(stub);

    const review = { event: "COMMENT" as const, body: "Looks fine.", comments: [] };
    await expect(session.submitReview(review)).rejects.toThrow(/moved on GitHub/);

    await session.submitReview({ ...review, allowStale: true });
    const submitted = stub.calls().find((call) => call[1]?.endsWith("/reviews"));
    expect(submitted).toBeDefined();
    // The comments still anchor to the head this session actually reviewed.
    expect(JSON.parse(stub.stdin())).toMatchObject({ commit_id: headSha, event: "COMMENT" });
  } finally {
    restore();
    await sessions.disposeProject(project.id);
  }
});

test("a session in a non-repo project runs in the project directory", async () => {
  const dir = tempDir("agent-manager-plain-");
  const project = await new ProjectManager().open(dir);
  const sessions = new SessionManager();

  const session = await sessions.create(project, { projectId: project.id, command: "cat" });

  expect(session.worktree).toBeUndefined();
  expect(session.cwd).toBe(dir);

  await sessions.dispose(session.id);
});
