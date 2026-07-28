import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type {
  ChangeEntry,
  ChangeStatus,
  SessionChanges,
  WorktreeInfo,
} from "@agent-manager/shared";
import { branchExists, runGit } from "./worktrees";

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

// The ref this worktree's changes are measured against: the point where it
// branched from the target branch. Falls back to HEAD (uncommitted changes
// only) when no target branch can be determined.
async function resolveBaseRef(worktree: WorktreeInfo): Promise<string> {
  const cwd = worktree.path;
  let target: string | null = null;

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

async function computeChanges(worktree: WorktreeInfo): Promise<ComputedChanges> {
  const cwd = worktree.path;
  const baseRef = await resolveBaseRef(worktree);
  const byPath = new Map<string, ChangeEntry>();

  // Committed + unstaged changes vs the base.
  const diff = await runGit(
    ["-c", "core.quotepath=false", "diff", "--name-status", "-z", baseRef],
    cwd,
  );
  if (diff.exitCode === 0) {
    const tokens = diff.stdout.split("\0").filter((t) => t.length > 0);
    for (let i = 0; i < tokens.length; ) {
      const code = tokens[i++]!;
      const letter = code[0]!;
      if (letter === "R" || letter === "C") {
        i++; // old path
        const newPath = tokens[i++];
        if (newPath) byPath.set(newPath, { path: newPath, status: mapStatus(letter) });
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

export async function listChanges(worktree: WorktreeInfo): Promise<SessionChanges> {
  const { baseRef, files } = await computeChanges(worktree);
  return { base: shortBase(baseRef), files };
}

// Writes the base-branch version of `relPath` to a fresh temp file and returns
// its path. Returns an empty file when the path does not exist in the base
// (added / untracked / renamed).
async function baseVersionToTemp(cwd: string, baseRef: string, relPath: string, dir: string): Promise<string> {
  const proc = Bun.spawn(["git", "show", `${baseRef}:${relPath}`], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  const exitCode = await proc.exited;

  const ext = extname(relPath);
  const file = join(dir, `${basename(relPath, ext) || "file"}${ext}`);
  writeFileSync(file, exitCode === 0 ? bytes : new Uint8Array());
  return file;
}

// Opens the clicked file's branch-relative diff in Zed: base version on the
// left, the live worktree file (editable, at its real path) on the right.
export async function openDiffInZed(worktree: WorktreeInfo, relPath: string): Promise<void> {
  const { baseRef, files } = await computeChanges(worktree);
  const entry = files.find((f) => f.path === relPath);
  if (!entry) {
    throw new Error(`No pending change for '${relPath}'.`);
  }

  const zed = Bun.which("zed");
  if (!zed) {
    throw new Error(
      "Zed CLI not found. Open Zed and run 'cli: install cli binary' from the command palette (⌘⇧P).",
    );
  }

  const dir = join(tmpdir(), "agent-manager-diff", randomUUID());
  mkdirSync(dir, { recursive: true });

  const oldSide = await baseVersionToTemp(worktree.path, baseRef, relPath, dir);

  let newSide = join(worktree.path, relPath);
  if (entry.status === "deleted") {
    // The file no longer exists in the worktree; give Zed an empty right side.
    const ext = extname(relPath);
    newSide = join(dir, `deleted-${basename(relPath, ext) || "file"}${ext}`);
    writeFileSync(newSide, new Uint8Array());
  }

  Bun.spawn([zed, "--diff", oldSide, newSide], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
}
