import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeTempDirs, tempRepo } from "../testRepo";
import { ReviewAssistant } from "./assistant";
import type { ProviderRequest, ReviewProvider } from "./provider";
import { readSource } from "../source";

const assistants: ReviewAssistant[] = [];
afterEach(() => {
  assistants.splice(0).forEach((assistant) => assistant.dispose());
  removeTempDirs();
});
function assistant(root: string, provider: ReviewProvider) {
  const result = new ReviewAssistant(
    root,
    { agent: "claude" },
    {
      provider,
      resolveLaunch: async () => ({
        command: "claude",
        agent: "claude",
        args: [],
      }),
    },
  );
  assistants.push(result);
  return result;
}
async function finished(review: ReviewAssistant) {
  const deadline = Date.now() + 2000;
  while (
    review
      .state()
      .jobs.some((job) => ["accepted", "running"].includes(job.status)) &&
    Date.now() < deadline
  )
    await Bun.sleep(5);
  expect(
    review
      .state()
      .jobs.some((job) => ["accepted", "running"].includes(job.status)),
  ).toBe(false);
}

test("requests serialize, preserve conversation identity and never replay accepted edits", async () => {
  const calls: ProviderRequest[] = [];
  const review = assistant(await tempRepo(), async (request) => {
    calls.push(request);
    await Bun.sleep(15);
    return { conversationId: "dedicated-review", value: { answer: "Done" } };
  });
  const edit = {
    requestId: "edit",
    question: "Fix it",
    mode: "change" as const,
  };
  review.submit(edit);
  review.submit(edit);
  review.submit({ requestId: "ask", question: "Explain it" });
  expect(() => review.submit({ ...edit, question: "Different" })).toThrow(
    "different content",
  );
  await finished(review);
  review.submit(edit);
  expect(calls).toHaveLength(2);
  expect(calls[1]?.conversationId).toBe("dedicated-review");
  expect(calls.map((call) => call.mode)).toEqual(["change", "ask"]);
});

test("cancelled and failed requests stay recorded and later requests still run", async () => {
  const review = assistant(
    await tempRepo(),
    (request) =>
      new Promise((resolve, reject) => {
        if (request.prompt.includes("fail"))
          return reject(new Error("provider failure"));
        request.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
        if (!request.prompt.includes("wait"))
          resolve({ conversationId: "review", value: { answer: "Done" } });
      }),
  );
  review.submit({ requestId: "first", question: "wait" });
  review.submit({ requestId: "second", question: "fail" });
  await Bun.sleep(20);
  review.cancel("first");
  await finished(review);
  expect(review.state().jobs.map((job) => job.status)).toEqual([
    "cancelled",
    "failed",
  ]);
  review.submit({ requestId: "second", question: "fail" });
  review.submit({ requestId: "third", question: "Explain" });
  await finished(review);
  expect(review.state().jobs.map((job) => job.status)).toEqual([
    "cancelled",
    "failed",
    "completed",
  ]);
});

test("changes require current selected code and report actual edited files", async () => {
  const root = await tempRepo();
  writeFileSync(join(root, "file.ts"), "const value = 1;\n");
  const source = await readSource(root, "file.ts");
  let edits = 0;
  const review = assistant(root, async () => {
    edits++;
    writeFileSync(join(root, "file.ts"), "const value = 2;\n");
    return { conversationId: "review", value: { answer: "Updated" } };
  });
  const request = {
    requestId: "edit",
    question: "Change value",
    mode: "change" as const,
    context: {
      path: "file.ts",
      side: "new" as const,
      startLine: 1,
      endLine: 1,
      lines: [{ line: 1, text: "const value = 1;" }],
      base: "main",
      selectedAt: new Date().toISOString(),
      currentVersion: source.version,
    },
  };
  review.submit(request);
  await finished(review);
  expect(review.state().jobs[0]?.changedFiles).toEqual(["file.ts"]);
  review.submit({ ...request, requestId: "stale-edit" });
  await finished(review);
  expect(edits).toBe(1);
  expect(review.state().jobs[1]?.error).toContain("Code changed");
});

test("session disposal cancels queued work and waits for the active provider to stop", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let stopped = false;
  const review = assistant(
    await tempRepo(),
    (request) =>
      new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => {
          setTimeout(() => {
            stopped = true;
            reject(new Error("cancelled"));
          }, 20);
        });
        started();
      }),
  );
  review.submit({ requestId: "running", question: "Explain" });
  review.submit({ requestId: "queued", question: "Explain more" });
  await ready;
  const disposal = review.dispose();
  expect(stopped).toBe(false);
  await disposal;
  expect(stopped).toBe(true);
  expect(review.state().jobs.map((job) => job.status)).toEqual([
    "cancelled",
    "cancelled",
  ]);
});
