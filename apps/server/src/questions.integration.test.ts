import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "./sessions";
import { formatQuestion } from "./questions";
import type { AskAgentRequest } from "@agent-manager/shared";

async function until(condition: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!condition() && Date.now() < deadline) await Bun.sleep(10);
  expect(condition()).toBe(true);
}

test("questions reach only their owning agent PTY with multiline paste and Enter", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "agent-question-"));
  const script = join(cwd, "interactive.ts");
  writeFileSync(script, `import { appendFileSync } from "node:fs";
process.stdin.setRawMode(true);
process.stdout.write("READY\\x1b[?2004h");
process.stdin.on("data", data => { appendFileSync(process.argv[2], data); process.stdout.write("RECEIVED"); });`);
  const sessions: Session[] = [];
  try {
    for (const agent of ["claude", "codex"] as const) {
      const log = join(cwd, agent);
      const session = new Session({ projectId: "test", title: agent, agent, command: process.execPath, args: [script, log], cwd });
      sessions.push(session);
      let output = "";
      session.attach(message => { if (message.type === "output") output += message.data; });
      await until(() => output.includes("READY"));
      const request: AskAgentRequest = { requestId: "same-id-in-each-session", question: `Explain ${agent}\non two lines`, context: {
        path: "old-name.py", side: "old", startLine: 12, endLine: 13,
        lines: [{ line: 12, text: "def answer():" }, { line: 13, text: "  return 42" }], base: "main", selectedAt: new Date().toISOString(),
      } };
      const result = await Promise.all([session.questions.submit(request), session.questions.submit(request)]);
      expect(result[0]?.status).toBe("submitted");
      const expected = `\x1b[200~${formatQuestion(request)}\x1b[201~\r`;
      await until(() => existsSync(log) && readFileSync(log, "utf8") === expected);
      expect(output).toContain("RECEIVED");
      if (agent === "codex") expect(readFileSync(join(cwd, "claude"), "utf8")).not.toContain("Explain codex");
      await session.dispose();
      expect(() => session.questions.submit({ ...request, requestId: "after-exit" })).toThrow(/exited/);
    }
  } finally {
    await Promise.all(sessions.map(session => session.dispose()));
    rmSync(cwd, { recursive: true, force: true });
  }
});
