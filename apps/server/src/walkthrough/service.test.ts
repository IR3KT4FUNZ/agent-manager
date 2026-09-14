import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAll, removeTempDirs, tempRepo } from "../testRepo";
import { ReviewAssistant } from "../review/assistant";
import { WalkthroughService } from "./service";
import type { ReviewProvider } from "../review/provider";
import type { DependencyGraph } from "@agent-manager/shared";

const assistants: ReviewAssistant[] = [];
afterEach(() => {
  assistants.splice(0).forEach((assistant) => assistant.dispose());
  removeTempDirs();
});
function generated(prompt: string) {
  const evidence = JSON.parse(
    prompt.slice(prompt.lastIndexOf('\n{"description"')),
  );
  const ids = (evidence.graph as DependencyGraph).nodes.map((node) => node.id);
  return {
    steps: [
      {
        title: "Helpers and uses",
        explanation: "The helper is used by the caller.",
        details: "Details",
        example: "A behavior example",
        reviewConsiderations: "Check caller behavior",
        nodeIds: ids,
      },
    ],
    impact: { explanation: "Overall effect", nodeIds: ids },
  };
}
async function setup(provider: ReviewProvider) {
  const root = await tempRepo();
  writeFileSync(
    join(root, "helper.ts"),
    "export function helper() { return 1; }\n",
  );
  writeFileSync(
    join(root, "use.ts"),
    "import { helper } from './helper';\nexport const answer = helper();\n",
  );
  await commitAll(root, "base");
  writeFileSync(
    join(root, "helper.ts"),
    "export function helper() { return 2; }\n",
  );
  const assistant = new ReviewAssistant(
    root,
    { agent: "claude" },
    {
      provider,
      resolveLaunch: async () => ({
        agent: "claude",
        command: "claude",
        args: [],
      }),
    },
  );
  assistants.push(assistant);
  const service = new WalkthroughService(
    assistant,
    { path: root, repoRoot: root, branch: "main" },
    () => undefined,
    () => undefined,
  );
  return { root, assistant, service };
}
async function finished(assistant: ReviewAssistant) {
  const deadline = Date.now() + 8000;
  while (
    assistant
      .state()
      .jobs.some((job) => ["accepted", "running"].includes(job.status)) &&
    Date.now() < deadline
  )
    await Bun.sleep(10);
  expect(
    assistant
      .state()
      .jobs.some((job) => ["accepted", "running"].includes(job.status)),
  ).toBe(false);
}

test("generation and questions share a conversation, references validate versions, and edits invalidate dependent steps", async () => {
  const ids: (string | undefined)[] = [];
  const { root, assistant, service } = await setup(async (request) => {
    ids.push(request.conversationId);
    return {
      conversationId: "review-tour",
      value: request.prompt.includes('\n{"description"')
        ? generated(request.prompt)
        : { answer: "Explanation" },
    };
  });
  assistant.submit({
    requestId: "question-first",
    question: "Explain this code",
  });
  service.generate("generate");
  await finished(assistant);
  const state = await service.state();
  expect(assistant.state().jobs.map((job) => job.status)).toEqual([
    "completed",
    "completed",
  ]);
  expect(ids).toEqual([undefined, "review-tour"]);
  const walkthrough = state.walkthrough!;
  const reference = walkthrough.steps[0]!.references.find(
    (reference) => reference.side === "new" && reference.path === "helper.ts",
  )!;
  expect(
    await service.resolveReference(walkthrough.version, reference.nodeId),
  ).toMatchObject({ path: "helper.ts" });
  expect(
    (await service.source(walkthrough.version, reference.nodeId)).content,
  ).toContain("return 2");
  assistant.submit({
    requestId: "step-question",
    question: "Why?",
    stepId: walkthrough.steps[0]!.id,
    walkthroughVersion: walkthrough.version,
  });
  await finished(assistant);
  expect(ids[2]).toBe("review-tour");
  expect(assistant.state().jobs.at(-1)?.stepContext?.title).toBe(
    walkthrough.steps[0]!.title,
  );
  writeFileSync(
    join(root, "helper.ts"),
    "export function helper() { return 3; }\n",
  );
  await expect(
    service.resolveReference(walkthrough.version, reference.nodeId),
  ).rejects.toThrow("changed");
  expect((await service.state()).staleSteps).toEqual(
    walkthrough.steps.map((step) => step.id),
  );
  assistant.submit({
    requestId: "stale-change",
    question: "Fix it",
    mode: "change",
    stepId: walkthrough.steps[0]!.id,
    walkthroughVersion: walkthrough.version,
  });
  await finished(assistant);
  expect(assistant.state().jobs.at(-1)?.error).toContain("outdated");
});

test("generation refuses to publish an explanation if code changes while the provider is working", async () => {
  let root: string;
  const result = await setup(async (request) => {
    writeFileSync(
      join(root, "helper.ts"),
      "export function helper() { return 99; }\n",
    );
    return { conversationId: "review", value: generated(request.prompt) };
  });
  root = result.root;
  result.service.generate("generate");
  await finished(result.assistant);
  expect(result.assistant.state().jobs[0]?.error).toContain(
    "Code changed while generating",
  );
  expect((await result.service.state()).walkthrough).toBeNull();
});
