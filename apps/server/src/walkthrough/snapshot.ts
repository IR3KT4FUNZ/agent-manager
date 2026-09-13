import { createHash } from "node:crypto";
import type { FileDiff, WorktreeInfo } from "@agent-manager/shared";
import {
  getFileDiff,
  listChanges,
  resolveBaseRef,
  runGitRaw,
} from "../changes";
import { readSource } from "../source";
import { runGit } from "../worktrees";

export interface AnalysisSnapshot {
  root: string;
  base: string;
  head: string;
  version: string;
  before: Record<string, string>;
  after: Record<string, string>;
  diffs: FileDiff[];
  changedPaths: string[];
  limitations: string[];
}

const MAX_FILES = 1500;
const MAX_BYTES = 16 * 1024 * 1024;
const relevant = (path: string) =>
  /\.(?:[cm]?[jt]sx?|json)$/.test(path) &&
  !/(^|\/)(node_modules|dist|target|\.git)\//.test(path);

export async function captureSnapshot(
  worktree: WorktreeInfo,
  target?: string,
  signal?: AbortSignal,
): Promise<AnalysisSnapshot> {
  const root = worktree.path;
  const base = await resolveBaseRef(worktree, target);
  const head = (await runGit(["rev-parse", "HEAD"], root)).stdout;
  const changes = await listChanges(worktree, target);
  const limitations: string[] = [];
  const current = await runGit(
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    root,
  );
  const old = await runGit(["ls-tree", "-r", "--name-only", "-z", base], root);
  if (current.exitCode || old.exitCode)
    throw new Error("Could not list files for walkthrough analysis.");
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  let bytes = 0;
  const paths = [
    ...new Set(
      [...current.stdout.split("\0"), ...old.stdout.split("\0")].filter(
        (path) =>
          relevant(path) ||
          changes.files.some(
            (file) => path === file.path || path === file.oldPath,
          ),
      ),
    ),
  ].sort();
  if (paths.length > MAX_FILES)
    limitations.push(
      `Analysis limited to ${MAX_FILES} source/configuration files.`,
    );
  for (const path of paths.slice(0, MAX_FILES)) {
    signal?.throwIfAborted();
    if (bytes >= MAX_BYTES) {
      limitations.push("Analysis reached its 16 MiB source budget.");
      break;
    }
    const document = await readSource(root, path).catch(() => null);
    if (document) {
      after[path] = document.content;
      bytes += Buffer.byteLength(document.content);
    }
    const size = await runGit(["cat-file", "-s", `${base}:${path}`], root);
    if (size.exitCode === 0 && Number(size.stdout) <= 1024 * 1024) {
      const contents = await runGitRaw(["show", `${base}:${path}`], root);
      if (!contents.exitCode && !contents.bytes.includes(0)) {
        try {
          before[path] = new TextDecoder("utf-8", { fatal: true }).decode(
            contents.bytes,
          );
          bytes += contents.bytes.length;
        } catch {
          limitations.push(`Base file ${path} is not UTF-8.`);
        }
      }
    }
  }
  const diffs: FileDiff[] = [];
  for (const entry of changes.files) {
    signal?.throwIfAborted();
    const diff = await getFileDiff(worktree, entry.path, base);
    diffs.push(diff);
    if (diff.kind !== "text") limitations.push(`${entry.path}: ${diff.kind}.`);
    else if (!/\.(?:[cm]?[jt]sx?)$/.test(entry.path))
      limitations.push(
        `${entry.path}: no TypeScript/JavaScript dependency analysis.`,
      );
  }
  const version = createHash("sha256")
    .update(JSON.stringify([base, head, before, after, diffs]))
    .digest("hex");
  const snapshot = {
    root,
    base,
    head,
    before,
    after,
    diffs,
    changedPaths: changes.files.map((file) => file.path),
    limitations,
    version,
  };
  if (!(await snapshotMatches(snapshot, worktree, target)))
    throw new Error(
      "Code changed during analysis. Generate the walkthrough again.",
    );
  return snapshot;
}

export async function snapshotMatches(
  snapshot: AnalysisSnapshot,
  worktree: WorktreeInfo,
  target?: string,
) {
  if ((await resolveBaseRef(worktree, target)) !== snapshot.base) return false;
  if (
    (await runGit(["rev-parse", "HEAD"], worktree.path)).stdout !==
    snapshot.head
  )
    return false;
  const changes = await listChanges(worktree, target);
  if (
    JSON.stringify(changes.files.map((file) => file.path)) !==
    JSON.stringify(snapshot.changedPaths)
  )
    return false;
  for (const path of new Set([
    ...Object.keys(snapshot.after),
    ...snapshot.changedPaths,
  ])) {
    const document = await readSource(worktree.path, path).catch(() => null);
    if (path in snapshot.after && document?.content !== snapshot.after[path])
      return false;
    const diff = snapshot.diffs.find((item) => item.path === path);
    if (diff?.currentVersion && document?.version !== diff.currentVersion)
      return false;
  }
  for (const expected of snapshot.diffs) {
    const current = await getFileDiff(
      worktree,
      expected.path,
      snapshot.base,
    ).catch(() => null);
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
  }
  return true;
}
