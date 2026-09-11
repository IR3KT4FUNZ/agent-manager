import type {
  PrAssociation,
  PrState,
  PrStatus,
  PrSummary,
  WorktreeInfo,
} from "@agent-manager/shared";
import { parsePrRef, prBranchName, runGhJson } from "./github";
import { createWorktreeAt, runGit } from "./worktrees";

const VIEW_FIELDS =
  "number,title,state,isDraft,url,baseRefName,headRefName,headRefOid,isCrossRepository,author";
const LIST_FIELDS = "number,title,url,isDraft,headRefName,author,updatedAt";
const LIST_LIMIT = 50;

interface RawAuthor {
  login?: string;
}

interface RawPrListItem {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  author?: RawAuthor;
  updatedAt: string;
}

interface RawPrView extends RawPrListItem {
  state: string;
  baseRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
}

function authorLogin(author?: RawAuthor): string {
  return author?.login ?? "unknown";
}

function toPrState(value: string): PrState {
  const state = value?.toUpperCase();
  return state === "CLOSED" || state === "MERGED" ? state : "OPEN";
}

function toPrSummary(raw: RawPrListItem): PrSummary {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    isDraft: raw.isDraft,
    headRefName: raw.headRefName,
    author: authorLogin(raw.author),
    updatedAt: raw.updatedAt,
  };
}

export function toPrAssociation(raw: RawPrView, baseRepo: string): PrAssociation {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: toPrState(raw.state),
    isDraft: raw.isDraft,
    baseRepo,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    headSha: raw.headRefOid,
    isCrossRepository: raw.isCrossRepository,
    author: authorLogin(raw.author),
  };
}

export async function listOpenPrs(repoRoot: string): Promise<PrSummary[]> {
  const raw = await runGhJson<RawPrListItem[]>(
    ["pr", "list", "--state", "open", "--limit", String(LIST_LIMIT), "--json", LIST_FIELDS],
    repoRoot,
  );
  return raw.map(toPrSummary);
}

export async function baseRepoOf(repoRoot: string): Promise<string> {
  const { nameWithOwner } = await runGhJson<{ nameWithOwner: string }>(
    ["repo", "view", "--json", "nameWithOwner"],
    repoRoot,
  );
  return nameWithOwner;
}

export async function resolvePrAssociation(
  repoRoot: string,
  input: string,
): Promise<PrAssociation> {
  const ref = parsePrRef(input);
  if (!ref) throw new Error(`'${input}' is not a pull request number or URL.`);

  const baseRepo = await baseRepoOf(repoRoot);
  if (ref.nameWithOwner && ref.nameWithOwner.toLowerCase() !== baseRepo.toLowerCase()) {
    throw new Error(
      `That pull request belongs to ${ref.nameWithOwner}, but this project is ${baseRepo}.`,
    );
  }

  const raw = await runGhJson<RawPrView>(
    ["pr", "view", String(ref.number), "--json", VIEW_FIELDS],
    repoRoot,
  );
  return toPrAssociation(raw, baseRepo);
}

// A stable local ref for the PR head, so the worktree does not depend on
// FETCH_HEAD. Pull refs are readable on forks with no extra remote.
export function prFetchRef(number: number): string {
  return `refs/agent-manager/pr/${number}`;
}

export async function fetchPrHead(repoRoot: string, pr: PrAssociation): Promise<void> {
  const head = await runGit(
    ["-C", repoRoot, "fetch", "origin", `+refs/pull/${pr.number}/head:${prFetchRef(pr.number)}`],
    repoRoot,
  );
  if (head.exitCode !== 0) {
    throw new Error(`Could not fetch pull request #${pr.number}: ${head.stderr}`);
  }

  // The diff base has to exist locally for the changed-file list to match GitHub.
  const base = await runGit(
    [
      "-C",
      repoRoot,
      "fetch",
      "origin",
      `+refs/heads/${pr.baseRefName}:refs/remotes/origin/${pr.baseRefName}`,
    ],
    repoRoot,
  );
  if (base.exitCode !== 0) {
    throw new Error(`Could not fetch the base branch '${pr.baseRefName}': ${base.stderr}`);
  }
}

export async function checkoutPrWorktree(
  repoRoot: string,
  pr: PrAssociation,
): Promise<WorktreeInfo> {
  await fetchPrHead(repoRoot, pr);
  return createWorktreeAt(repoRoot, {
    branchFor: (attempt) => prBranchName(pr.number, pr.headRefName, attempt),
    startRef: prFetchRef(pr.number),
  });
}

async function findPrForBranch(repoRoot: string, branch: string): Promise<PrAssociation | null> {
  const raw = await runGhJson<RawPrView[]>(
    ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", VIEW_FIELDS],
    repoRoot,
  );
  const match = raw[0];
  return match ? toPrAssociation(match, await baseRepoOf(repoRoot)) : null;
}

async function remoteHeadShaOf(repoRoot: string, number: number): Promise<string | null> {
  const { headRefOid } = await runGhJson<{ headRefOid: string }>(
    ["pr", "view", String(number), "--json", "headRefOid"],
    repoRoot,
  );
  return headRefOid ?? null;
}

async function pathsChangedSince(worktree: WorktreeInfo, headSha: string): Promise<string[]> {
  const changed = await runGit(
    ["-c", "core.quotepath=false", "diff", "--name-only", "-z", headSha],
    worktree.path,
  );
  const untracked = await runGit(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    worktree.path,
  );
  const paths = new Set<string>();
  for (const result of [changed, untracked]) {
    if (result.exitCode !== 0) continue;
    for (const path of result.stdout.split("\0")) if (path) paths.add(path);
  }
  return [...paths].sort();
}

// GitHub anchors review comments to the PR head, so the panel has to know when
// the worktree or the remote has moved away from it. The gh lookups behind this
// are cached; the local git flags are always fresh.
export const PR_LOOKUP_TTL_MS = 60_000;

export interface PrLookup {
  at: number;
  pr: PrAssociation | null;
  remoteHeadSha: string | null;
}

async function lookUpPr(
  worktree: WorktreeInfo,
  associated: PrAssociation | undefined,
): Promise<PrLookup> {
  const at = Date.now();
  try {
    if (associated) {
      return { at, pr: associated, remoteHeadSha: await remoteHeadShaOf(worktree.repoRoot, associated.number) };
    }
    const discovered = await findPrForBranch(worktree.repoRoot, worktree.branch);
    return { at, pr: discovered, remoteHeadSha: discovered?.headSha ?? null };
  } catch {
    // A GitHub hiccup should not blank out the panel: keep what we know.
    return { at, pr: associated ?? null, remoteHeadSha: null };
  }
}

export async function loadPrStatus(
  worktree: WorktreeInfo,
  associated: PrAssociation | undefined,
  cached: PrLookup | undefined,
): Promise<{ status: PrStatus; lookup: PrLookup }> {
  const fresh = cached && Date.now() - cached.at < PR_LOOKUP_TTL_MS && cached.pr?.number === associated?.number;
  const lookup = fresh ? cached : await lookUpPr(worktree, associated);
  const { pr, remoteHeadSha } = lookup;

  if (!pr) {
    return {
      status: {
        pr: null,
        localDirty: false,
        localAhead: false,
        remoteAdvanced: false,
        remoteHeadSha: null,
        modifiedSinceHead: [],
      },
      lookup,
    };
  }

  const dirty = await runGit(["status", "--porcelain"], worktree.path);
  const head = await runGit(["rev-parse", "HEAD"], worktree.path);

  return {
    status: {
      pr,
      localDirty: dirty.exitCode === 0 && dirty.stdout.length > 0,
      localAhead: head.exitCode === 0 && head.stdout !== pr.headSha,
      remoteAdvanced: remoteHeadSha !== null && remoteHeadSha !== pr.headSha,
      remoteHeadSha,
      modifiedSinceHead: await pathsChangedSince(worktree, pr.headSha),
    },
    lookup,
  };
}

export async function syncWorktreeToPrHead(
  worktree: WorktreeInfo,
  pr: PrAssociation,
): Promise<string> {
  await fetchPrHead(worktree.repoRoot, pr);
  const reset = await runGit(["reset", "--hard", prFetchRef(pr.number)], worktree.path);
  if (reset.exitCode !== 0) {
    throw new Error(`Could not update the worktree to the PR head: ${reset.stderr}`);
  }
  return (await runGit(["rev-parse", "HEAD"], worktree.path)).stdout;
}
