import { expect, test } from "bun:test";
import type { FileDiff, AskAgentResult } from "@agent-manager/shared";
import { captureDiffContext, contextPreview, DiffComposerStore } from "./diffComposer";

const diff: FileDiff = {
  path: "new.py", oldPath: "old.py", status: "renamed", base: "main", currentVersion: "a".repeat(64),
  kind: "text", additions: 1, deletions: 1, oldSize: 10, newSize: 10,
  hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, header: "", lines: [
    { kind: "context", oldLine: 1, newLine: 1, text: "long wrapped line ".repeat(100) },
    { kind: "del", oldLine: 2, newLine: null, text: "old_value" },
    { kind: "add", oldLine: null, newLine: 2, text: "new_value" },
  ] }, { oldStart: 10, oldLines: 1, newStart: 10, newLines: 1, header: "", lines: [
    { kind: "context", oldLine: 10, newLine: 10, text: "last" },
  ] }],
};

test("captures original logical lines, renamed old paths and gaps across hunks", () => {
  const old = captureDiffContext(diff, { side: "LEFT", line: 10, startLine: 1 });
  expect(old.path).toBe("old.py");
  expect(old.lines.map(item => item.line)).toEqual([1, 2, 10]);
  expect(old.lines[0]!.text).toBe(diff.hunks[0]!.lines[0]!.text);
  expect(contextPreview(old)).toContain("2: old_value\n… intervening lines not displayed …\n10: last");
  const current = captureDiffContext(diff, { side: "RIGHT", line: 2 });
  expect(current.path).toBe("new.py");
  expect(current.lines).toEqual([{ line: 2, text: "new_value" }]);
  expect(current.currentVersion).toBe(diff.currentVersion);
});

test("drafts retain text, destination and frozen context by session/file/selection", () => {
  const store = new DiffComposerStore();
  const anchor = { side: "RIGHT" as const, line: 2 };
  store.open("first", diff, anchor);
  const first = store.get("first", diff.path)!;
  expect(first.destination).toBe("agent");
  store.update(first.id, { text: "Why?", destination: "github" });
  store.open("second", diff, anchor);
  expect(store.get("second", diff.path)!.text).toBe("");
  store.open("first", diff, { side: "LEFT", line: 2 });
  store.open("first", { ...diff, currentVersion: "b".repeat(64), hunks: [] }, anchor);
  expect(store.get("first", diff.path)).toMatchObject({ text: "Why?", destination: "github", context: first.context });
  store.cancel(first.id);
  expect(store.get("first", diff.path)).toBeUndefined();
});

test("agent delivery stays with its captured session through switches and clears only on success", async () => {
  const store = new DiffComposerStore();
  store.open("first", diff, { side: "RIGHT", line: 2 });
  const draft = store.get("first", diff.path)!;
  store.update(draft.id, { text: "Question" });
  let resolve!: (result: AskAgentResult) => void;
  const pending = store.send(draft.id, async (sessionId, request) => {
    expect(sessionId).toBe("first");
    expect(request.question).toBe("Question");
    return new Promise<AskAgentResult>(done => { resolve = done; });
  });
  store.open("second", diff, { side: "LEFT", line: 2 });
  store.cancel(draft.id);
  expect(store.get("first", diff.path)?.pending).toBe(true);
  resolve({ requestId: draft.requestId, status: "submitted" });
  await pending;
  expect(store.get("first", diff.path)).toBeUndefined();
  expect(store.get("second", diff.path)).toBeDefined();
  expect(store.focusKey("first")).toBe(1);
  expect(store.focusKey("second")).toBe(0);
});

test("network retries preserve IDs and questions; GitHub drafts never deliver to the terminal", async () => {
  const store = new DiffComposerStore();
  store.open("one", diff, { side: "RIGHT", line: 2 });
  const draft = store.get("one", diff.path)!;
  store.update(draft.id, { text: "Question" });
  const id = store.get("one", diff.path)!.requestId;
  await store.send(draft.id, async () => { throw new Error("offline"); });
  expect(store.get("one", diff.path)).toMatchObject({ text: "Question", requestId: id, error: "offline", pending: false });
  await store.send(draft.id, async (_, request) => { expect(request.requestId).toBe(id); throw new Error("offline"); });
  store.update(draft.id, { destination: "github" });
  let calls = 0;
  await store.send(draft.id, async () => { calls++; return { requestId: id, status: "submitted" }; });
  expect(calls).toBe(0);
  expect(store.get("one", diff.path)?.text).toBe("Question");
});
