import type { GithubStatus } from "@agent-manager/shared";

const GH_ENV = {
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
  NO_COLOR: "1",
  GIT_TERMINAL_PROMPT: "0",
};

const INSTALL_HINT =
  "GitHub CLI not found. Install it with 'brew install gh', then run 'gh auth login'.";

const MAX_BRANCH_LENGTH = 40;

export function findGh(): string {
  const gh = process.env.AGENT_MANAGER_GH || Bun.which("gh", { PATH: process.env.PATH ?? "" });
  if (!gh) throw new Error(INSTALL_HINT);
  return gh;
}

export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runGh(
  args: string[],
  cwd: string,
  options: { stdin?: string } = {},
): Promise<GhResult> {
  const proc = Bun.spawn([findGh(), ...args], {
    cwd,
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...GH_ENV },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: await proc.exited };
}

// A failing `gh api` prints a terse line on stderr but the useful part — the
// API's own `errors` — in the JSON body on stdout.
function apiErrorDetail(stdout: string): string {
  try {
    const body = JSON.parse(stdout) as {
      message?: string;
      errors?: (string | { message?: string })[];
    };
    const errors = (body.errors ?? [])
      .map((error) => (typeof error === "string" ? error : error.message))
      .filter((error): error is string => Boolean(error));
    return errors.length > 0 ? errors.join("; ") : (body.message ?? "");
  } catch {
    return "";
  }
}

export async function runGhJson<T>(
  args: string[],
  cwd: string,
  options: { stdin?: string } = {},
): Promise<T> {
  const { stdout, stderr, exitCode } = await runGh(args, cwd, options);
  if (exitCode !== 0) {
    throw new Error(friendlyGhError([apiErrorDetail(stdout), stderr].filter(Boolean).join("\n")));
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`Unexpected response from 'gh ${args[0] ?? ""}'.`);
  }
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.replace(/^[✗×!\s-]+/, "").trim())
      .find((line) => line.length > 0) ?? ""
  );
}

export function friendlyGhError(stderr: string): string {
  const text = stderr.toLowerCase();
  if (
    text.includes("gh auth login") ||
    text.includes("not logged") ||
    text.includes("bad credentials") ||
    text.includes("http 401")
  ) {
    return "Not signed in to GitHub. Run 'gh auth login' in a terminal, then try again.";
  }
  if (text.includes("rate limit")) {
    return "GitHub API rate limit reached. Try again in a few minutes.";
  }
  if (
    text.includes("http 404") ||
    text.includes("could not resolve to") ||
    text.includes("no pull requests found")
  ) {
    return "Not found on GitHub — check the pull request number and that you have access to the repository.";
  }
  if (
    text.includes("none of the git remotes") ||
    text.includes("no git remotes") ||
    text.includes("not a git repository")
  ) {
    return "No GitHub remote found for this repository.";
  }
  return firstLine(stderr) || "The GitHub CLI failed without reporting an error.";
}

export function parseGhLogin(output: string): string | undefined {
  return output.match(/logged in to \S+ (?:account |as )([A-Za-z0-9](?:[A-Za-z0-9-]*))/i)?.[1];
}

export async function checkGithubStatus(cwd: string = process.cwd()): Promise<GithubStatus> {
  try {
    findGh();
  } catch {
    return { installed: false, authenticated: false, message: INSTALL_HINT };
  }
  try {
    const { stdout, stderr, exitCode } = await runGh(["auth", "status"], cwd);
    if (exitCode !== 0) {
      return { installed: true, authenticated: false, message: friendlyGhError(stderr || stdout) };
    }
    return { installed: true, authenticated: true, login: parseGhLogin(`${stdout}\n${stderr}`) };
  } catch (error) {
    return {
      installed: true,
      authenticated: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface PrRef {
  number: number;
  nameWithOwner?: string;
}

export function parsePrRef(input: string): PrRef | null {
  const value = input.trim();
  const url = value.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i,
  );
  if (url) return { number: Number(url[3]), nameWithOwner: `${url[1]}/${url[2]}` };

  const plain = value.match(/^#?(\d+)$/);
  if (plain && Number(plain[1]) > 0) return { number: Number(plain[1]) };
  return null;
}

export function prBranchName(number: number, headRefName: string, attempt = 0): string {
  const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
  const slug = headRefName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = slug ? `pr-${number}-${slug}` : `pr-${number}`;
  return `${name.slice(0, MAX_BRANCH_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
}
