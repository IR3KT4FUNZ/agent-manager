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

export async function tempRepo(options: { commit?: boolean } = {}): Promise<string> {
  const dir = tempDir("agent-manager-repo-");
  await runGit(["init", "-b", "main"], dir);
  if (options.commit !== false) {
    writeFileSync(join(dir, "README.md"), "hello\n");
    await runGit(["add", "."], dir);
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
        "init",
      ],
      dir,
    );
  }
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
