import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "./worktrees";

const created: string[] = [];

export function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await runGit(["add", "-A"], dir);
  await runGit(
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      message,
    ],
    dir,
  );
}

export async function tempRepo(options: { commit?: boolean } = {}): Promise<string> {
  const dir = tempDir("agent-manager-repo-");
  await runGit(["init", "-b", "main"], dir);
  if (options.commit !== false) {
    writeFileSync(join(dir, "README.md"), "hello\n");
    await commitAll(dir, "init");
  }
  return dir;
}

// A repo whose "origin" carries refs/pull/1/head, exactly like GitHub serves
// it. The PR branch exists only on origin, as it would for a fork.
export async function tempRepoWithPullRequest(): Promise<{ repo: string; headSha: string }> {
  const origin = tempDir("agent-manager-origin-");
  await runGit(["init", "--bare", "-b", "main"], origin);

  const repo = await tempRepo();
  await runGit(["remote", "add", "origin", origin], repo);
  await runGit(["push", "origin", "main"], repo);

  await runGit(["checkout", "-b", "feature"], repo);
  writeFileSync(join(repo, "widget.txt"), "widget\n");
  await commitAll(repo, "add a widget");
  const headSha = (await runGit(["rev-parse", "HEAD"], repo)).stdout;
  await runGit(["push", "origin", "HEAD:refs/pull/1/head"], repo);

  await runGit(["checkout", "main"], repo);
  await runGit(["branch", "-D", "feature"], repo);
  return { repo, headSha };
}

export async function pushToPullRequest(repo: string, file: string): Promise<string> {
  await runGit(["checkout", "-b", "pushed", `refs/agent-manager/pr/1`], repo);
  writeFileSync(join(repo, file), "more\n");
  await commitAll(repo, "another commit");
  const headSha = (await runGit(["rev-parse", "HEAD"], repo)).stdout;
  await runGit(["push", "--force", "origin", "HEAD:refs/pull/1/head"], repo);
  await runGit(["checkout", "main"], repo);
  await runGit(["branch", "-D", "pushed"], repo);
  return headSha;
}

export function removeTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
