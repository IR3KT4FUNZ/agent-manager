import type { BranchReview, BranchReviewRequest, ProjectBranches } from "@agent-manager/shared";
import { runGit } from "./worktrees";

export async function listBranches(repoRoot: string): Promise<ProjectBranches> {
  const [refs, head, originHead] = await Promise.all([
    runGit(["for-each-ref", "--format=%(refname:short)%09%(symref)", "refs/heads", "refs/remotes"], repoRoot),
    runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repoRoot),
    runGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], repoRoot),
  ]);
  if (refs.exitCode) throw new Error("Could not list repository branches.");
  const branches = refs.stdout.split("\n").filter(Boolean).flatMap((line) => {
    const [name, symbolic] = line.split("\t");
    return name && !symbolic ? [name] : [];
  });
  const defaultBase = [originHead.stdout, "origin/main", "main", "origin/master", "master"]
    .find((ref) => branches.includes(ref)) ?? (head.stdout || "HEAD");
  return { branches, currentBranch: head.stdout || "HEAD", defaultBase };
}

async function resolveCommit(repoRoot: string, value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().startsWith("-") || /[\x00-\x1f]/.test(value)) {
    throw new Error(`Choose a valid ${label} branch or commit.`);
  }
  const ref = value.trim();
  const result = await runGit(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], repoRoot);
  if (result.exitCode) throw new Error(`The ${label} ref '${ref}' is not available locally. Fetch it first or choose another ref.`);
  return { ref, sha: result.stdout };
}

export async function resolveBranchReview(repoRoot: string, request: BranchReviewRequest): Promise<BranchReview> {
  if (!request || typeof request !== "object") throw new Error("Choose a branch and base to review.");
  const [head, base] = await Promise.all([
    resolveCommit(repoRoot, request.headRef, "review"),
    resolveCommit(repoRoot, request.baseRef, "base"),
  ]);
  const mergeBase = await runGit(["merge-base", head.sha, base.sha], repoRoot);
  if (mergeBase.exitCode) throw new Error("The review and base refs do not share a common ancestor.");
  return { headRef: head.ref, baseRef: base.ref, headSha: head.sha, baseSha: base.sha };
}
