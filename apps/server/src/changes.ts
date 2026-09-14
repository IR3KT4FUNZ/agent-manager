import { readSource } from "./source";
import { statSync } from "node:fs";
import { join } from "node:path";
import type {
  ChangeEntry,
  ChangeStatus,
  FileDiff,
  SessionChanges,
  WorktreeInfo,
} from "@agent-manager/shared";
import { parseUnifiedDiff } from "./diffParse";
import { branchExists, runGit } from "./worktrees";

const MAX_FILE_BYTES = 1024 * 1024;
const DIFF_CONTEXT_LINES = 3;

export class NoSuchChangeError extends Error {}

function mapStatus(code: string): ChangeStatus {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    default:
      return "modified"; // M, T (type change), etc.
  }
}

function shortBase(baseRef: string): string {
  return baseRef === "HEAD" ? "HEAD" : baseRef.slice(0, 8);
}

// `runGit` trims its output, which would silently corrupt a diff's leading and
// trailing blank lines; diffs are read as raw bytes instead.
export async function runGitRaw(
  args: string[],
  cwd: string,
): Promise<{ bytes: Uint8Array; exitCode: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  const exitCode = await proc.exited;
  return { bytes, exitCode };
}

// The ref this worktree's changes are measured against: the point where it
// branched from the target branch. Falls back to HEAD (uncommitted changes
// only) when no target branch can be determined.
export async function resolveBaseRef(worktree: WorktreeInfo, targetOverride?: string): Promise<string> {
  const cwd = worktree.path;
  let target: string | null = targetOverride ?? null;

  if (target === null) {
    const originHead = await runGit(["rev-parse", "--abbrev-ref", "origin/HEAD"], cwd);
    if (originHead.exitCode === 0 && originHead.stdout) {
      target = originHead.stdout; // e.g. "origin/main"
    } else {
      for (const name of ["main", "master"]) {
        if (await branchExists(worktree.repoRoot, name)) {
          target = name;
          break;
        }
      }
    }
  }

  if (target) {
    const mergeBase = await runGit(["merge-base", "HEAD", target], cwd);
    if (mergeBase.exitCode === 0 && mergeBase.stdout) return mergeBase.stdout;
  }
  return "HEAD";
}

interface ComputedChanges {
  baseRef: string;
  files: ChangeEntry[];
}

async function computeChanges(
  worktree: WorktreeInfo,
  targetOverride?: string,
): Promise<ComputedChanges> {
  const cwd = worktree.path;
  const baseRef = await resolveBaseRef(worktree, targetOverride);
  const byPath = new Map<string, ChangeEntry>();

  // Committed + unstaged changes vs the base.
  const diff = await runGit(
    ["-c", "core.quotepath=false", "diff", "--name-status", "--find-renames", "-z", baseRef],
    cwd,
  );
  if (diff.exitCode === 0) {
    const tokens = diff.stdout.split("\0").filter((t) => t.length > 0);
    for (let i = 0; i < tokens.length; ) {
      const code = tokens[i++]!;
      const letter = code[0]!;
      if (letter === "R" || letter === "C") {
        const oldPath = tokens[i++];
        const newPath = tokens[i++];
        if (newPath) byPath.set(newPath, { path: newPath, oldPath, status: mapStatus(letter) });
      } else {
        const path = tokens[i++];
        if (path) byPath.set(path, { path, status: mapStatus(letter) });
      }
    }
  }

  // Untracked files (not yet added to git).
  const untracked = await runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  if (untracked.exitCode === 0) {
    for (const path of untracked.stdout.split("\0").filter((t) => t.length > 0)) {
      if (!byPath.has(path)) byPath.set(path, { path, status: "untracked" });
    }
  }

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { baseRef, files };
}

export async function listChanges(
  worktree: WorktreeInfo,
  targetOverride?: string,
): Promise<SessionChanges> {
  const { baseRef, files } = await computeChanges(worktree, targetOverride);
  return { base: targetOverride ?? shortBase(baseRef), files };
}

async function baseFileSize(cwd: string, baseRef: string, relPath: string): Promise<number> {
  const { stdout, exitCode } = await runGit(["cat-file", "-s", `${baseRef}:${relPath}`], cwd);
  const size = Number(stdout);
  return exitCode === 0 && Number.isFinite(size) ? size : 0;
}

function worktreeFileSize(cwd: string, relPath: string): number {
  try {
    return statSync(join(cwd, relPath)).size;
  } catch {
    return 0;
  }
}

function diffArgs(baseRef: string, entry: ChangeEntry): string[] {
  const common = ["-c", "core.quotepath=false", "diff", "--no-color", `-U${DIFF_CONTEXT_LINES}`];
  if (entry.status === "untracked") {
    return [...common, "--no-index", "--", "/dev/null", entry.path];
  }
  // A rename is only re-detected when both halves of the pair are in the pathspec.
  const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
  return [...common, "--find-renames", baseRef, "--", ...paths];
}

export async function getFileDiff(
  worktree: WorktreeInfo,
  relPath: string,
  targetOverride?: string,
): Promise<FileDiff> {
  const cwd = worktree.path;
  const { baseRef, files } = await computeChanges(worktree, targetOverride);
  const entry = files.find((f) => f.path === relPath);
  if (!entry) throw new NoSuchChangeError(`No pending change for '${relPath}'.`);

  const oldSize =
    entry.status === "untracked" ? 0 : await baseFileSize(cwd, baseRef, entry.oldPath ?? relPath);
  const newSize = worktreeFileSize(cwd, relPath);

  const diff: FileDiff = {
    baseVersion: baseRef,
    path: relPath,
    oldPath: entry.oldPath,
    status: entry.status,
    base: targetOverride ?? shortBase(baseRef),
    kind: "text",
    hunks: [],
    additions: 0,
    deletions: 0,
    oldSize,
    newSize,
  };

  if (oldSize > MAX_FILE_BYTES || newSize > MAX_FILE_BYTES) return { ...diff, kind: "too-large" };

  // `--no-index` reports "files differ" as exit code 1, which is the normal case here.
  const before = await readSource(cwd, entry.path).catch(() => null);
  const { bytes, exitCode } = await runGitRaw(diffArgs(baseRef, entry), cwd);
  const after = await readSource(cwd, entry.path).catch(() => null);
  const failed = entry.status === "untracked" ? exitCode > 1 : exitCode !== 0;
  if (failed) throw new Error(`git could not diff '${relPath}'.`);
  if (bytes.length > MAX_FILE_BYTES) return { ...diff, kind: "too-large" };

  const parsed = parseUnifiedDiff(new TextDecoder().decode(bytes));
  if (parsed.isBinary) return { ...diff, kind: "binary" };
  return {
    ...diff,
    currentVersion: before && before.version === after?.version ? before.version : undefined,
    hunks: parsed.hunks,
    additions: parsed.additions,
    deletions: parsed.deletions,
  };
}
