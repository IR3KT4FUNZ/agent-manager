import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodexModel } from "@agent-manager/shared";
import { tempDir } from "./testRepo";

export const testModel: CodexModel = {
  model: "test-model",
  displayName: "Test Model",
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [
    { reasoningEffort: "medium", description: "Balanced" },
    { reasoningEffort: "high", description: "More reasoning" },
  ],
};

export function fakeCodex(mode: "normal" | "error" | "malformed" | "hang" | "fragmented" = "normal") {
  const dir = tempDir("agent-manager-codex-");
  const path = join(dir, "codex");
  const requests = join(dir, "requests.jsonl");
  const launches = join(dir, "launches.jsonl");
  const pidFile = join(dir, "pid");
  writeFileSync(path, `#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
const mode = ${JSON.stringify(mode)};
const requests = ${JSON.stringify(requests)};
const launches = ${JSON.stringify(launches)};
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
const args = process.argv.slice(2);
const isDiscovery = args[0] === "app-server";
if (!isDiscovery) {
  appendFileSync(launches, JSON.stringify({ args, cwd: process.cwd(), term: process.env.TERM }) + "\\n");
  console.log("FAKE_AGENT_READY");
}
let buffered = "";
for await (const chunk of Bun.stdin.stream()) {
  buffered += new TextDecoder().decode(chunk);
  while (buffered.includes("\\n")) {
    const newline = buffered.indexOf("\\n");
    const line = buffered.slice(0, newline);
    buffered = buffered.slice(newline + 1);
    if (!isDiscovery) {
      console.log("ECHO:" + line);
      continue;
    }
    const request = JSON.parse(line);
    appendFileSync(requests, JSON.stringify(request) + "\\n");
    if (mode === "hang" || request.method === "initialized") continue;
    if (mode === "malformed") { console.log("not json"); continue; }
    const result = request.method === "initialize" ? {} :
      request.params.cursor ? { data: [], nextCursor: null } :
      { data: [${JSON.stringify(testModel)}], nextCursor: "page-two" };
    const response = JSON.stringify(mode === "error"
      ? { id: request.id, error: { message: "Unsupported CLI" } }
      : { id: request.id, result }) + "\\n";
    if (mode === "fragmented") {
      process.stdout.write(response.slice(0, 9));
      await Bun.sleep(5);
      process.stdout.write(response.slice(9));
    } else process.stdout.write(response);
  }
}
`, { mode: 0o755 });
  const readLines = (file: string) => existsSync(file)
    ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return {
    path,
    requests: () => readLines(requests) as { id?: number; method: string; params?: { cursor?: string } }[],
    launches: () => readLines(launches) as { args: string[]; cwd: string; term: string }[],
    pid: () => Number(readFileSync(pidFile, "utf8")),
  };
}
