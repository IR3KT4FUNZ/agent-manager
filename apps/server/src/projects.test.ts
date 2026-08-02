import { afterAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ProjectManager } from "./projects";
import { removeTempDirs, tempDir, tempRepo } from "./testRepo";

afterAll(removeTempDirs);

test("a repo opened from a subdirectory is rooted at the repo", async () => {
  const repo = await tempRepo();
  const subdir = join(repo, "packages", "web");
  mkdirSync(subdir, { recursive: true });

  const project = await new ProjectManager().open(subdir);

  expect(project.info()).toMatchObject({ path: repo, isRepo: true });
  expect(project.repoRoot).toBe(repo);
});

test("reopening the same repo reuses the existing project", async () => {
  const repo = await tempRepo();
  const projects = new ProjectManager();

  const first = await projects.open(repo);
  const second = await projects.open(join(repo, "."));

  expect(second.id).toBe(first.id);
  expect(projects.list()).toHaveLength(1);
});

test("a plain directory opens as a project with no repo", async () => {
  const dir = tempDir("agent-manager-plain-");

  const project = await new ProjectManager().open(dir);

  expect(project.repoRoot).toBeNull();
  expect(project.info()).toMatchObject({ path: dir, isRepo: false });
});

test("a repo without commits cannot be opened", async () => {
  const repo = await tempRepo({ commit: false });

  expect(new ProjectManager().open(repo)).rejects.toThrow(/no commits/);
});

test("a path that is not a directory cannot be opened", async () => {
  const repo = await tempRepo();

  expect(new ProjectManager().open(join(repo, "README.md"))).rejects.toThrow(/Not a directory/);
});

test("closing a project drops it from the list", async () => {
  const projects = new ProjectManager();
  const project = await projects.open(await tempRepo());

  expect(projects.close(project.id)).toBe(true);
  expect(projects.get(project.id)).toBeUndefined();
  expect(projects.list()).toHaveLength(0);
});
