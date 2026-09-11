import { expect, test } from "bun:test";
import type { AskAgentRequest } from "@agent-manager/shared";
import { AgentQuestions, formatQuestion, MAX_QUESTION_BYTES, safeTerminalText, validateQuestion } from "./questions";

function request(): AskAgentRequest {
  return { requestId: "question-1", question: "Why?\nExplain this.", context: {
    path: "src/file.ts", side: "new", startLine: 2, endLine: 8,
    lines: [{ line: 2, text: "const value = `hello`;" }, { line: 8, text: "export { value };" }],
    base: "main", selectedAt: "2026-09-11T12:00:00Z", currentVersion: "a".repeat(64),
  } };
}

test("prompt preserves numbered snapshot and marks omitted hunk context", () => {
  const value = request();
  value.context.lines[0]!.text = "````\x1b[201~\x00";
  const prompt = formatQuestion(validateQuestion(value));
  expect(prompt).toContain("Question: Why?\nExplain this.");
  expect(prompt).toContain("src/file.ts (new side, lines 2-8)");
  expect(prompt).toContain("2: ````[201~\n[intervening lines not displayed in the selected diff]\n8: export { value };");
  expect(prompt).toContain("\n`````\n");
  expect(prompt).not.toContain("\x1b");
  expect(prompt).not.toContain("\x00");
  expect(safeTerminalText("a\r\nb\rc\t\x03\x7f\x9bd")).toBe("a\nb\nc\td");
});

test("validates selection shape, nonempty text, and UTF-8 payload size", () => {
  for (const patch of [
    { question: "\x03 \n" }, { requestId: "bad id" },
    { context: { ...request().context, path: "../secret" } },
    { context: { ...request().context, path: "/secret" } },
    { context: { ...request().context, side: "RIGHT" } },
    { context: { ...request().context, startLine: 1 } },
    { context: { ...request().context, lines: [{ line: 2, text: "first\nsecond" }] } },
    { context: { ...request().context, currentVersion: "bad" } },
    { context: { ...request().context, selectedAt: "yesterday" } },
  ]) expect(() => validateQuestion({ ...request(), ...patch })).toThrow();
  const value = request();
  value.question = "😀".repeat(MAX_QUESTION_BYTES / 4);
  expect(() => validateQuestion(value)).toThrow(/64 KiB/);
  value.question = "fine";
  expect(validateQuestion(value)).toEqual(value);
});

test("deduplicates pending and delivered requests and serializes paste/Enter pairs", async () => {
  const writes: string[] = [];
  const questions = new AgentQuestions({ agent: "codex", running: () => true, write: data => { writes.push(data); } });
  const first = request();
  const second = { ...request(), requestId: "question-2" };
  await Promise.all([questions.submit(first), questions.submit(first), questions.submit(second)]);
  expect(await questions.submit(first)).toEqual({ requestId: first.requestId, status: "submitted" });
  expect(writes).toEqual([`\x1b[200~${formatQuestion(first)}\x1b[201~`, "\r", `\x1b[200~${formatQuestion(second)}\x1b[201~`, "\r"]);
  expect(() => questions.submit({ ...first, question: "Different" })).toThrow(/different question/);
});

test("rejects custom and exited sessions without writing", () => {
  for (const target of [{ agent: undefined, running: () => true }, { agent: "claude" as const, running: () => false }]) {
    const writes: string[] = [];
    const questions = new AgentQuestions({ ...target, write: data => { writes.push(data); } });
    expect(() => questions.submit(request())).toThrow();
    expect(writes).toEqual([]);
  }
});

test("failures before delivery can recover; uncertain writes never replay", async () => {
  let running = true;
  const writes: string[] = [];
  const questions = new AgentQuestions({ agent: "claude", running: () => running, write: data => { writes.push(data); } });
  const pending = questions.submit(request());
  running = false;
  await expect(pending).rejects.toThrow(/exited/);
  running = true;
  await questions.submit(request());
  expect(writes).toHaveLength(2);

  let attempts = 0;
  const broken = new AgentQuestions({ agent: "codex", running: () => true, write: () => { attempts++; throw new Error("PTY disconnected"); } });
  await expect(broken.submit(request())).rejects.toThrow("PTY disconnected");
  await expect(broken.submit(request())).rejects.toThrow("PTY disconnected");
  expect(attempts).toBe(1);
});
