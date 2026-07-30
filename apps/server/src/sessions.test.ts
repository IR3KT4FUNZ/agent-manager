import { afterAll, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { ProjectManager } from "./projects";
import { SessionManager } from "./sessions";
import { removeTempDirs, tempDir, tempRepo } from "./testRepo";
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

test("a session in a non-repo project runs in the project directory", async () => {
  const dir = tempDir("agent-manager-plain-");
  const project = await new ProjectManager().open(dir);
  const sessions = new SessionManager();

  const session = await sessions.create(project, { projectId: project.id, command: "cat" });

  expect(session.worktree).toBeUndefined();
  expect(session.cwd).toBe(dir);

  await sessions.dispose(session.id);
});
