---
name: prune-workspaces
description: Delete workspaces (git worktrees) whose branch has already been merged, after proving nothing unmerged would be lost. Use when workspaces have piled up, when per-workspace build artifacts are filling the disk, or when asked to clean up old, merged, finished, or unused workspaces or worktrees.
---

# Prune merged workspaces

Every workspace is a git worktree on its own branch, so `git worktree list` is the
inventory and the branch is the unit of "is this finished?". Each one also carries its
own build artifacts (`apps/desktop/src-tauri/target` alone is ~2 GB), which is usually
why the user wants them gone.

Deletion is irreversible for anything not already on the remote. The rule is: **prove the
workspace holds nothing that isn't already merged, then ask before deleting.** Never
delete on inference — every candidate must pass the checks in step 3.

Requires `gh` and a GitHub remote. Without them, stop and say so: squash merges make
`git branch --merged` unreliable, so there is no safe local-only substitute.

## 1. Inventory

```sh
git worktree list --porcelain     # blocks of: worktree <path> / HEAD <sha> / branch refs/heads/<name>
git rev-parse --show-toplevel     # the workspace you are running in
```

Two worktrees are never candidates: the current one, and the main worktree (the first
block, holding the default branch).

## 2. Classify each remaining worktree

```sh
gh pr list --head <branch> --state all --json number,state,mergedAt,headRefOid,url
```

Read **every** PR for the branch, not just the newest — workspaces get reused across
features, so a branch can have a merged PR *and* an open one.

| Finding | Verdict |
|---|---|
| Any `OPEN` PR | **Keep.** Work is in review. |
| `MERGED` PR and its `headRefOid` == the worktree's `git -C <path> rev-parse HEAD` | **Candidate.** The worktree is exactly what was merged. |
| `MERGED` PR but HEAD has moved past `headRefOid` | **Keep.** Report the extra work: `git -C <path> log --oneline <headRefOid>..HEAD` |
| No PR at all | **Keep** — unless the worktree is empty (below). |

The SHA equality is the whole proof. Do not substitute `git diff <default-branch>...HEAD`
being empty: this repo squash-merges, so a merged branch still shows its full diff against
main and that check would keep everything forever.

**Empty workspaces.** A no-PR worktree that is clean *and* identical to the default branch
(both `git -C <path> diff <default-branch>...HEAD` and `git -C <path> status --porcelain`
print nothing) was never used — typically a worktree the server orphaned on restart. It has
nothing to lose. List these as their own group, still confirmed before deletion.

## 3. Refuse anything dirty

For every candidate, before it reaches the confirmation list:

```sh
git -C <path> status --porcelain   # must print nothing
```

Untracked files count. They are frequently real work, or a `.env` that exists nowhere else.
Non-empty output means keep, and say which files kept it alive.

## 4. Confirm

Show a table — workspace, branch, why it qualifies (PR number and merge date), and size
from `du -sh <path>` — plus the list of what you are keeping and the reason for each.
Wait for an explicit yes. Never fold deletion into another task's confirmation.

## 5. Delete

```sh
git worktree remove <path>        # no --force: it aborts on anything dirty, which is the point
git branch -D <branch>            # local branch only, and only after step 2 passed
git worktree prune                # clears metadata for directories already deleted by hand
```

`git branch -d` refuses squash-merged branches, because their commits never became
ancestors of main; `-D` is correct here *only* because the `headRefOid` check proved the
content is merged.

Then clean up what the removal leaves behind:

```sh
find <workspaces-parent> -maxdepth 1 -type l ! -exec test -e {} \; -print
```

Conductor keeps a sibling symlink named after the branch (`fix-tab-drag-reorder -> quebec`)
next to each workspace directory; removing the worktree strands it. Delete the broken ones.

Leave remote branches alone — GitHub deletes them on merge, and pushing branch deletions
is not this skill's job.

## Cautions

- If a workspace is open in the Conductor app or has a running agent session, archive it
  from the UI instead. Deleting the directory under a running app leaves it confused.
- Worktrees under `~/agent-manager/workspaces/` belong to Agent Manager sessions. A live
  session's worktree is not garbage — check the app's session list before treating one as
  an orphan.
