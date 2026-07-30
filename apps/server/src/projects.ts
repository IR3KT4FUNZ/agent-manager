import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ProjectInfo } from "@agent-manager/shared";
import { repoHasCommits, resolveRepoRoot } from "./worktrees";

export function resolveDirectory(path?: string): string {
  if (!path) return homedir();
  const expanded =
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
    throw new Error(`Not a directory: ${expanded}`);
  }
  return realpathSync(expanded);
}

export class Project {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();

  constructor(
    readonly root: string,
    readonly repoRoot: string | null,
  ) {}

  info(): ProjectInfo {
    return {
      id: this.id,
      name: basename(this.root),
      path: this.root,
      isRepo: this.repoRoot !== null,
      createdAt: this.createdAt,
    };
  }
}

export class ProjectManager {
  private projects = new Map<string, Project>();

  async open(path?: string): Promise<Project> {
    const dir = resolveDirectory(path);
    const repoRoot = await resolveRepoRoot(dir);
    if (repoRoot && !(await repoHasCommits(repoRoot))) {
      throw new Error("Repository has no commits yet; make an initial commit first.");
    }

    const root = repoRoot ?? dir;
    const existing = [...this.projects.values()].find((project) => project.root === root);
    if (existing) return existing;

    const project = new Project(root, repoRoot);
    this.projects.set(project.id, project);
    return project;
  }

  get(id: string): Project | undefined {
    return this.projects.get(id);
  }

  list(): ProjectInfo[] {
    return [...this.projects.values()].map((project) => project.info());
  }

  close(id: string): boolean {
    return this.projects.delete(id);
  }
}
