import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import type { DependencyGraph, ReviewRequest } from "@agent-manager/shared";
import { listBranches, resolveBranchReview } from "./branches";
import { getFileDiff, listChanges } from "./changes";
import { ProjectManager } from "./projects";
import { SessionManager } from "./sessions";
import { reviewRoutes } from "./review/routes";
import { stubGh, useStubGh } from "./testGh";
import { commitAll, removeTempDirs, tempDir, tempRepo } from "./testRepo";
import { runGit } from "./worktrees";

const managers: SessionManager[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) {
    for (const session of manager.list()) await manager.dispose(session.id);
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  removeTempDirs();
});

async function repository() {
  const repo = await tempRepo();
  roots.push(join(homedir(), "agent-manager", "workspaces", basename(repo)));
  writeFileSync(join(repo, "helper.ts"), "export const answer = 1;\n");
  await commitAll(repo, "helper");
  await runGit(["checkout", "-b", "release"], repo);
  writeFileSync(join(repo, "release.txt"), "release only\n");
  await commitAll(repo, "release");
  await runGit(["checkout", "-b", "feature"], repo);
  writeFileSync(join(repo, "helper.ts"), "export const answer = 2;\n");
  await commitAll(repo, "feature");
  await runGit(["checkout", "release"], repo);
  writeFileSync(join(repo, "base-only.txt"), "later base change\n");
  await commitAll(repo, "advance base");
  await runGit(["checkout", "main"], repo);
  return repo;
}

test("branch suggestions include local and fetched remote refs and omit symbolic remote HEAD", async () => {
  const repo = await repository();
  await runGit(["update-ref", "refs/remotes/origin/release", "release"], repo);
  await runGit(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/release"], repo);
  expect(await listBranches(repo)).toEqual({
    branches: ["feature", "main", "release", "origin/release"],
    currentBranch: "main",
    defaultBase: "origin/release",
  });
  expect(await resolveBranchReview(repo, { headRef: "feature", baseRef: "origin/release" }))
    .toMatchObject({ baseRef: "origin/release", baseSha: (await runGit(["rev-parse", "release"], repo)).stdout });
});

test("invalid branch review requests fail without creating worktrees", async () => {
  const repo = await repository();
  const project = await new ProjectManager().open(repo);
  const manager = new SessionManager();
  managers.push(manager);
  for (const branchReview of [
    { headRef: "missing", baseRef: "main" },
    { headRef: "feature", baseRef: "missing" },
    { headRef: "feature", baseRef: "--all" },
    { headRef: "", baseRef: "main" },
    null,
  ]) {
    await expect(manager.create(project, {
      projectId: project.id, command: "cat", branchReview: branchReview as never,
    })).rejects.toThrow();
  }
  await expect(manager.create(project, {
    projectId: project.id, command: "cat", prNumber: 1,
    branchReview: { headRef: "feature", baseRef: "release" },
  })).rejects.toThrow("either a pull request or a branch diff");
  await runGit(["checkout", "--orphan", "unrelated"], repo);
  await commitAll(repo, "unrelated history");
  await expect(resolveBranchReview(repo, { headRef: "feature", baseRef: "unrelated" }))
    .rejects.toThrow("common ancestor");
  expect((await runGit(["worktree", "list", "--porcelain"], repo)).stdout.match(/^worktree /gm)).toHaveLength(1);
  expect(manager.list()).toEqual([]);
  const plain = await new ProjectManager().open(tempDir("branch-review-plain-"));
  await expect(manager.create(plain, {
    projectId: plain.id, command: "cat", branchReview: { headRef: "feature", baseRef: "main" },
  })).rejects.toThrow("git repository");
});

test("branch reviews keep the selected comparison, support walkthroughs and review turns, and never use GitHub", async () => {
  const repo = await repository();
  const project = await new ProjectManager().open(repo);
  const modes: string[] = [];
  const manager = new SessionManager(undefined, {
    resolveLaunch: async () => ({ agent: "claude", command: "claude", args: [] }),
    provider: async (request) => {
      modes.push(request.mode);
      if (request.prompt.includes('\n{"description"')) {
        const evidence = JSON.parse(request.prompt.slice(request.prompt.lastIndexOf('\n{"description"')));
        const nodeIds = (evidence.graph as DependencyGraph).nodes.map((node) => node.id);
        return { conversationId: "branch-review", value: {
          steps: [{ title: "Answer", explanation: "Answer changes", details: "", example: "", reviewConsiderations: "", nodeIds }],
          impact: { explanation: "Updated answer", nodeIds },
        } };
      }
      if (request.mode === "change") writeFileSync(join(request.cwd, "helper.ts"), "export const answer = 3;\n");
      return { conversationId: "branch-review", value: { answer: "Reviewed" } };
    },
  });
  managers.push(manager);
  const gh = stubGh("exit 1");
  const restore = useStubGh(gh);
  try {
    const session = await manager.create(project, {
      projectId: project.id, command: "cat", branchReview: { headRef: "feature", baseRef: "release" },
    });
    const worktree = session.worktree!;
    expect(session.info()).toMatchObject({ title: "feature vs release", branchReview: { headRef: "feature", baseRef: "release" } });
    expect((await runGit(["rev-parse", "HEAD"], session.cwd)).stdout).toBe(session.branchReview!.headSha);
    expect(readFileSync(join(repo, "helper.ts"), "utf8")).toContain("answer = 1");
    expect((await listChanges(worktree, session.diffBase())).files.map((file) => file.path)).toEqual(["helper.ts"]);
    expect((await getFileDiff(worktree, "helper.ts", session.diffBase())).hunks[0]?.lines)
      .toContainEqual(expect.objectContaining({ kind: "add", text: "export const answer = 2;" }));
    await runGit(["branch", "-f", "release", "main"], repo);
    await runGit(["branch", "-f", "feature", "main"], repo);
    expect((await listChanges(worktree, session.diffBase())).files.map((file) => file.path)).toEqual(["helper.ts"]);
    expect((await session.prStatus()).pr).toBeNull();
    expect(session.reviewAssociation()).toBeNull();
    expect(await session.prThreads()).toEqual([]);
    await expect(session.submitReview({ event: "COMMENT", comments: [] })).rejects.toThrow("not reviewing a pull request");
    await expect(session.replyToComment(1, "hello")).rejects.toThrow("not reviewing a pull request");
    await expect(session.syncToPrHead()).rejects.toThrow("not reviewing a pull request");

    session.review.configure({ agent: "claude" });
    const app = reviewRoutes(manager);
    async function post(path: string, body: unknown) {
      const response = await app.request(`/${session.id}/${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(202);
      const deadline = Date.now() + 8000;
      while (session.review.state().jobs.some((job) => ["accepted", "running"].includes(job.status)) && Date.now() < deadline) await Bun.sleep(10);
      expect(session.review.state().jobs.at(-1)?.status).toBe("completed");
    }
    await post("walkthrough", { requestId: "tour" });
    expect((await session.walkthrough.state()).walkthrough?.steps[0]?.title).toBe("Answer");
    for (const mode of ["ask", "change"] as const) {
      await post("review/messages", { requestId: mode, mode, question: "Review the answer" } satisfies ReviewRequest);
    }
    expect(modes).toEqual(["ask", "ask", "change"]);
    expect(readFileSync(join(session.cwd, "helper.ts"), "utf8")).toContain("answer = 3");
    expect(readFileSync(join(repo, "helper.ts"), "utf8")).toContain("answer = 1");
    expect(gh.calls()).toEqual([]);
    await manager.dispose(session.id);
    expect(existsSync(worktree.path)).toBe(false);
  } finally {
    restore();
  }
}, 20000);
