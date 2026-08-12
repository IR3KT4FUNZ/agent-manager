import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./testRepo";

export interface StubGh {
  path: string;
  calls(): string[][];
  stdin(): string;
}

// A fake `gh` on disk: it records every invocation's argv and stdin, then runs
// `script`, whose job is to emit canned output for the command under test.
export function stubGh(script: string): StubGh {
  const dir = tempDir("agent-manager-gh-");
  const callLog = join(dir, "calls");
  const stdinLog = join(dir, "stdin");
  const path = join(dir, "gh");

  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `for arg in "$@"; do printf '%s\\n' "$arg" >> ${callLog}; done`,
      `printf -- '--\\n' >> ${callLog}`,
      `cat >> ${stdinLog}`,
      script,
    ].join("\n"),
    { mode: 0o755 },
  );

  return {
    path,
    calls() {
      if (!existsSync(callLog)) return [];
      return readFileSync(callLog, "utf8")
        .split("--\n")
        .filter((call) => call.length > 0)
        .map((call) => call.split("\n").filter((arg) => arg.length > 0));
    },
    stdin() {
      return existsSync(stdinLog) ? readFileSync(stdinLog, "utf8") : "";
    },
  };
}

export function useStubGh(stub: StubGh): () => void {
  const previous = process.env.AGENT_MANAGER_GH;
  process.env.AGENT_MANAGER_GH = stub.path;
  return () => {
    if (previous === undefined) delete process.env.AGENT_MANAGER_GH;
    else process.env.AGENT_MANAGER_GH = previous;
  };
}
