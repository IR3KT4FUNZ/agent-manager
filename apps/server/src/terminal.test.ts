import { describe, expect, test } from "bun:test";
import { resolveShell } from "./terminal";

describe("resolveShell", () => {
  test("uses SHELL when set", () => {
    expect(resolveShell({ SHELL: "/bin/bash" })).toEqual({ command: "/bin/bash", args: ["-l"] });
  });

  test("falls back to zsh as a login shell", () => {
    expect(resolveShell({})).toEqual({ command: "/bin/zsh", args: ["-l"] });
  });
});
