import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import {
  checkGithubStatus,
  friendlyGhError,
  parsePrRef,
  prBranchName,
  runGhJson,
} from "./github";
import { stubGh, useStubGh } from "./testGh";
import { removeTempDirs, tempDir } from "./testRepo";

afterAll(removeTempDirs);

describe("parsePrRef", () => {
  test("accepts a bare number, a #number, and a pull request URL", () => {
    expect(parsePrRef(" 123 ")).toEqual({ number: 123 });
    expect(parsePrRef("#123")).toEqual({ number: 123 });
    expect(parsePrRef("https://github.com/octo/repo.js/pull/7/files")).toEqual({
      number: 7,
      nameWithOwner: "octo/repo.js",
    });
  });

  test("rejects anything else", () => {
    for (const input of ["", "abc", "0", "https://github.com/octo/repo/issues/7"]) {
      expect(parsePrRef(input)).toBeNull();
    }
  });
});

describe("prBranchName", () => {
  test("sanitizes the head branch into a pr-<number>-<slug> branch", () => {
    expect(prBranchName(12, "Feature/Add_Widgets!")).toBe("pr-12-feature-add-widgets");
  });

  test("truncates long names without leaving a trailing dash, and suffixes retries", () => {
    const long = prBranchName(9, "a-very-long-head-branch-name-that-keeps-going");
    expect(long).toBe("pr-9-a-very-long-head-branch-name-that-k");
    expect(long.length).toBe(40);

    const retry = prBranchName(9, "a-very-long-head-branch-name-that-keeps-going", 1);
    expect(retry).toBe("pr-9-a-very-long-head-branch-name-that-2");
    expect(retry.length).toBe(40);
  });
});

describe("friendlyGhError", () => {
  test("maps the failures worth explaining", () => {
    expect(friendlyGhError("gh: To get started with GitHub CLI, please run: gh auth login")).toMatch(
      /gh auth login/,
    );
    expect(friendlyGhError("HTTP 404: Not Found")).toMatch(/Not found on GitHub/);
    expect(friendlyGhError("API rate limit exceeded")).toMatch(/rate limit/);
  });

  test("falls back to the first meaningful line", () => {
    expect(friendlyGhError("✗ something broke\nmore detail")).toBe("something broke");
    expect(friendlyGhError("")).toMatch(/without reporting an error/);
  });
});

describe("checkGithubStatus", () => {
  test("reports the logged-in account", async () => {
    const restore = useStubGh(stubGh("echo '✓ Logged in to github.com account octocat (keyring)'"));
    try {
      expect(await checkGithubStatus(tmpdir())).toEqual({
        installed: true,
        authenticated: true,
        login: "octocat",
      });
    } finally {
      restore();
    }
  });

  test("reports a friendly message instead of throwing when gh is not authenticated", async () => {
    const restore = useStubGh(stubGh("echo 'gh auth login required' >&2; exit 1"));
    try {
      const status = await checkGithubStatus(tmpdir());
      expect(status).toMatchObject({ installed: true, authenticated: false });
      expect(status.message).toMatch(/gh auth login/);
    } finally {
      restore();
    }
  });

  test("reports gh as missing when it is not on PATH", async () => {
    const gh = process.env.AGENT_MANAGER_GH;
    const path = process.env.PATH;
    delete process.env.AGENT_MANAGER_GH;
    process.env.PATH = tempDir("agent-manager-empty-path-");
    try {
      expect(await checkGithubStatus(tmpdir())).toMatchObject({
        installed: false,
        authenticated: false,
      });
    } finally {
      if (gh !== undefined) process.env.AGENT_MANAGER_GH = gh;
      process.env.PATH = path;
    }
  });
});

describe("runGhJson", () => {
  test("passes stdin through and parses the response", async () => {
    const stub = stubGh("echo '{\"ok\":true}'");
    const restore = useStubGh(stub);
    try {
      const body = await runGhJson<{ ok: boolean }>(["api", "repos/o/r"], tmpdir(), {
        stdin: '{"body":"hi"}',
      });
      expect(body).toEqual({ ok: true });
      expect(stub.calls()).toEqual([["api", "repos/o/r"]]);
      expect(stub.stdin()).toBe('{"body":"hi"}');
    } finally {
      restore();
    }
  });

  test("turns a gh failure into a friendly error", async () => {
    const restore = useStubGh(stubGh("echo 'HTTP 404: Not Found' >&2; exit 1"));
    try {
      await expect(runGhJson(["pr", "view", "1"], tmpdir())).rejects.toThrow(/Not found on GitHub/);
    } finally {
      restore();
    }
  });
});
