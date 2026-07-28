import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { WorktreeInfo } from "@agent-manager/shared";

const ADJECTIVES = [
  "amber", "brisk", "calm", "clever", "cosmic", "dapper", "eager", "fabled",
  "gentle", "hazel", "jolly", "keen", "lively", "mellow", "nimble", "olive",
  "plucky", "quiet", "rustic", "silver", "tidal", "upbeat", "vivid", "witty",
];

const NOUNS = [
  "otter", "wren", "maple", "harbor", "comet", "ember", "falcon", "grove",
  "heron", "island", "juniper", "kestrel", "lantern", "meadow", "nebula", "orchard",
  "pebble", "quartz", "raven", "summit", "thicket", "umber", "valley", "willow",
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function generateWorkspaceName(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}

export async function runGit(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

export async function resolveRepoRoot(dir: string): Promise<string | null> {
  const { stdout, exitCode } = await runGit(["-C", dir, "rev-parse", "--show-toplevel"], dir);
  return exitCode === 0 && stdout ? stdout : null;
}

export async function repoHasCommits(repoRoot: string): Promise<boolean> {
  const { exitCode } = await runGit(["-C", repoRoot, "rev-parse", "--verify", "--quiet", "HEAD"], repoRoot);
  return exitCode === 0;
}

export async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  const { exitCode } = await runGit(
    ["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    repoRoot,
  );
  return exitCode === 0;
}

export function worktreePathFor(repoRoot: string, name: string): string {
  return join(homedir(), "agent-manager", "workspaces", basename(repoRoot), name);
}

export async function createWorktree(repoRoot: string): Promise<WorktreeInfo> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const base = generateWorkspaceName();
    const name = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (await branchExists(repoRoot, name)) continue;

    const path = worktreePathFor(repoRoot, name);
    const { exitCode, stderr } = await runGit(
      ["-C", repoRoot, "worktree", "add", "-b", name, path, "HEAD"],
      repoRoot,
    );
    if (exitCode === 0) return { path, branch: name, repoRoot };
    if (!stderr.includes("already exists")) {
      throw new Error(`Failed to create git worktree: ${stderr}`);
    }
  }
  throw new Error("Failed to create git worktree: could not find a free branch name");
}

export async function removeWorktree(info: WorktreeInfo): Promise<void> {
  const { exitCode, stderr } = await runGit(
    ["-C", info.repoRoot, "worktree", "remove", "--force", info.path],
    info.repoRoot,
  );
  if (exitCode !== 0) {
    throw new Error(`Failed to remove git worktree: ${stderr}`);
  }
}

export async function discardWorktree(info: WorktreeInfo): Promise<void> {
  await removeWorktree(info);
  await runGit(["-C", info.repoRoot, "branch", "-D", info.branch], info.repoRoot);
}
