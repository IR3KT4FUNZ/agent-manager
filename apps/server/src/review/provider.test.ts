import { afterEach, expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeTempDirs, tempDir } from "../testRepo";
import {
  createReviewProvider,
  parseProviderOutput,
  type ProviderRequest,
} from "./provider";

afterEach(removeTempDirs);
function stub(root: string, hang = false) {
  const path = join(root, "agent");
  writeFileSync(
    path,
    `#!${process.execPath}\nconst args = process.argv.slice(2);\nconst input = await Bun.stdin.text();\nawait Bun.write(${JSON.stringify(join(root, "request.json"))}, JSON.stringify({ args, input }));\n${hang ? "setInterval(() => {}, 1000);" : `const value = { answer: "Explained" };\nif (args[0] === "exec") {\nconsole.log(JSON.stringify({type:"thread.started", thread_id:"codex-review"}));\nconsole.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:JSON.stringify(value)}}));\n} else console.log(JSON.stringify({session_id:"claude-review",structured_output:value}));`}`,
  );
  chmodSync(path, 0o755);
  return path;
}

test("both CLI adapters send structured prompts and explicitly resume conversations with per-turn permissions", async () => {
  for (const agent of ["claude", "codex"] as const) {
    const root = tempDir("review-provider-");
    const run = createReviewProvider(() => stub(root));
    const request: ProviderRequest = {
      cwd: root,
      selection: { agent },
      mode: "ask",
      prompt: "Explain code",
      schema: { type: "object" },
      signal: new AbortController().signal,
    };
    const result = await run(request);
    expect(result.value).toEqual({ answer: "Explained" });
    const first = JSON.parse(readFileSync(join(root, "request.json"), "utf8"));
    expect(first.input).toBe("Explain code");
    expect(first.args).toContain(
      agent === "codex" ? 'sandbox_mode="read-only"' : "dontAsk",
    );
    await run({
      ...request,
      mode: "change",
      conversationId: result.conversationId,
    });
    const second = JSON.parse(readFileSync(join(root, "request.json"), "utf8"));
    expect(second.args).toContain(result.conversationId);
    expect(second.args).toContain(
      agent === "codex" ? 'sandbox_mode="workspace-write"' : "acceptEdits",
    );
    await run({ ...request, conversationId: result.conversationId });
    expect(
      JSON.parse(readFileSync(join(root, "request.json"), "utf8")).args,
    ).toContain(agent === "codex" ? 'sandbox_mode="read-only"' : "dontAsk");
  }
});

test("cancel and timeout terminate CLI work and malformed output cannot become an answer", async () => {
  const root = tempDir("review-stop-");
  const binary = stub(root, true);
  const controller = new AbortController();
  const request: ProviderRequest = {
    cwd: root,
    selection: { agent: "claude" },
    mode: "ask",
    prompt: "Wait",
    schema: {},
    signal: controller.signal,
  };
  const pending = createReviewProvider(() => binary)(request);
  setTimeout(() => controller.abort(), 100);
  await expect(pending).rejects.toThrow();
  await expect(
    createReviewProvider(
      () => binary,
      50,
    )({ ...request, signal: new AbortController().signal }),
  ).rejects.toThrow("five minutes");
  expect(() =>
    parseProviderOutput("codex", '{"type":"thread.started","thread_id":"id"}'),
  ).toThrow("no structured");
  expect(() =>
    parseProviderOutput(
      "claude",
      '{"session_id":"id","result":"not structured"}',
    ),
  ).toThrow("no structured");
});
