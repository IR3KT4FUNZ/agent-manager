import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "./sessions";
import { reviewRoutes } from "./review/routes";
import type { AskAgentRequest } from "@agent-manager/shared";

test("HTTP diff questions reach the review assistant without writing to either terminal", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "agent-question-"));
  const script = join(cwd, "interactive.ts");
  const log = join(cwd, "input");
  writeFileSync(script, `import { appendFileSync } from "node:fs"; process.stdin.setRawMode(true); process.stdin.on("data", data => appendFileSync(process.argv[2], data)); setInterval(() => {}, 1000);`);
  const prompts: string[] = [];
  const session = new Session({ projectId: "test", title: "test", agent: "claude", command: process.execPath, args: [script, log], cwd }, {
    resolveLaunch: async () => ({ command: "claude", agent: "claude", args: [] }),
    provider: async request => { prompts.push(request.prompt); return { conversationId: "review", value: { answer: "Explanation" } }; },
  });
  const shell = session.terminal();
  const shellWrites: string[] = [];
  shell.write = data => { shellWrites.push(data); };
  const app = reviewRoutes({ get: () => session });
  const request: AskAgentRequest = { requestId: "question", question: "Explain", context: {
    path: "old.py", side: "old", startLine: 1, endLine: 1, lines: [{ line: 1, text: "print(1)" }], base: "main", selectedAt: new Date().toISOString(),
  } };
  try {
    for (let i = 0; i < 2; i++) {
      const response = await app.request(`/${session.id}/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      expect(response.status).toBe(200);
    }
    const deadline = Date.now() + 2000;
    while (session.review.state().jobs[0]?.status !== "completed" && Date.now() < deadline) await Bun.sleep(10);
    expect(session.review.state().jobs[0]?.answer).toBe("Explanation");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("old.py (old side");
    expect(existsSync(log)).toBe(false);
    expect(shellWrites).toEqual([]);
    session.status = "exited";
    expect(session.review.submit({ ...request, requestId: "after-agent-exit" }).status).toBe("submitted");
  } finally { session.dispose(); rmSync(cwd, { recursive: true, force: true }); }
});
