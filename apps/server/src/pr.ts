import type { PrAssociation, PrState, PrSummary, WorktreeInfo } from "@agent-manager/shared";
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
