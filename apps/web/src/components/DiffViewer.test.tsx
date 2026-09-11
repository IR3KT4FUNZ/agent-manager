import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FileDiff, PrStatus } from "@agent-manager/shared";
import { DiffViewer } from "./DiffViewer";
import { diffComposers } from "../lib/diffComposer";

const browser = new Window({ url: "http://localhost" });
const globals = { window: browser, document: browser.document, localStorage: browser.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map<string, PropertyDescriptor | undefined>();
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let sessionId: string;
const diff: FileDiff = {
  path: "file.ts", oldPath: "previous.ts", kind: "text", status: "renamed", base: "main", currentVersion: "a".repeat(64),
  additions: 1, deletions: 1, oldSize: 3, newSize: 3,
  hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, header: "", lines: [
    { kind: "context", oldLine: 1, newLine: 1, text: "wrapped ".repeat(100) },
    { kind: "del", oldLine: 2, newLine: null, text: "old" },
    { kind: "add", oldLine: null, newLine: 2, text: "new" },
  ] }],
};

beforeAll(() => {
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});
beforeEach(() => {
  sessionId = crypto.randomUUID();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
  client.setQueryData(["sessions"], [{ id: sessionId, agent: "claude", status: "running" }]);
  client.setQueryData(["diff", sessionId, diff.path], diff);
  client.setQueryData(["session-pr", sessionId], { pr: null, modifiedSinceHead: [] });
  client.setQueryData(["pr-comments", sessionId], []);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); client.clear(); });
afterAll(async () => {
  await browser.happyDOM.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function render() {
  await act(() => root.render(<QueryClientProvider client={client}><DiffViewer sessionId={sessionId} path={diff.path} /></QueryClientProvider>));
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === label || item.textContent === label)!;
}

async function pointer(target: EventTarget, type: string) {
  await act(() => target.dispatchEvent(
    new browser.PointerEvent(type, { bubbles: true, button: 0 }) as unknown as PointerEvent,
  ));
}

test("accessible gutter selection opens a fixed snapshot and restores the unsent draft after remount", async () => {
  await render();
  const gutter = button("Ask about or comment on old line 2");
  expect(gutter.closest('[aria-hidden="true"]')).toBeNull();
  await act(() => gutter.click());
  expect(container.textContent).toContain("previous.ts · old side · lines 2–2");
  expect(container.querySelector<HTMLOptionElement>('option[value="github"]')?.disabled).toBe(true);
  const draft = diffComposers.get(sessionId, diff.path)!;
  await act(() => diffComposers.update(draft.id, { text: "Explain old code" }));
  await act(() => root.render(null));
  await render();
  expect(container.querySelector("textarea")?.value).toBe("Explain old code");
  await act(() => client.setQueryData(["diff", sessionId, diff.path], { ...diff, hunks: [] }));
  await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  expect(container.querySelector("pre")?.textContent).toBe("2: old");
  await act(() => button("Cancel").click());
  expect(diffComposers.get(sessionId, diff.path)).toBeUndefined();
});

test("GitHub choice preserves text and saves only a local review draft; edited anchors disable it", async () => {
  const pr = { number: 1, baseRepo: "test/repo", headSha: "a".repeat(40), title: "Test", state: "OPEN" };
  client.setQueryData(["session-pr", sessionId], { pr, modifiedSinceHead: [] } as unknown as PrStatus);
  client.setQueryData(["diff", sessionId, diff.path], { ...diff, reviewHeadSha: pr.headSha, reviewAnchorsValid: true });
  await render();
  await act(() => button("Ask about or comment on new line 2").click());
  const draft = diffComposers.get(sessionId, diff.path)!;
  await act(() => diffComposers.update(draft.id, { text: "Review question" }));
  const destination = container.querySelector("select")!;
  await act(() => {
    destination.value = "github";
    destination.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event);
  });
  expect(container.querySelector("textarea")?.value).toBe("Review question");
  expect(button("Add to review")).toBeDefined();
  await act(() => container.querySelector("form")!.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event));
  expect(diffComposers.get(sessionId, diff.path)).toBeUndefined();
  expect(diffComposers.focusKey(sessionId)).toBe(0);
  expect(JSON.parse(localStorage.getItem("agent-manager.pr-draft.test/repo#1")!).comments).toMatchObject([{ path: "file.ts", side: "RIGHT", line: 2, body: "Review question" }]);
  await act(() => button("Ask about or comment on old line 2").click());
  await act(() => client.setQueryData(["diff", sessionId, diff.path], { ...diff, reviewHeadSha: pr.headSha, reviewAnchorsValid: false }));
  await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  expect(container.querySelector<HTMLOptionElement>('option[value="github"]')?.disabled).toBe(true);
  expect(container.textContent).toContain("Local changes no longer match");
  expect(button("Ask agent")).toBeDefined();
});

test("range dragging stays on one side and captures the diff displayed at pointer down", async () => {
  await render();
  await act(() => button("Ask about or comment on new line 2").dispatchEvent(
    new browser.PointerEvent("pointerdown", { bubbles: true, button: 0 }) as unknown as PointerEvent,
  ));
  await act(() => button("Ask about or comment on old line 1").dispatchEvent(
    new browser.PointerEvent("pointerover", { bubbles: true }) as unknown as PointerEvent,
  ));
  await act(() => button("Ask about or comment on new line 1").dispatchEvent(
    new browser.PointerEvent("pointerover", { bubbles: true }) as unknown as PointerEvent,
  ));
  await act(() => client.setQueryData(["diff", sessionId, diff.path], {
    ...diff, currentVersion: "b".repeat(64),
    hunks: diff.hunks.map(hunk => ({ ...hunk, lines: hunk.lines.map(line => ({ ...line, text: "changed while dragging" })) })),
  }));
  await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  await act(() => window.dispatchEvent(new browser.PointerEvent("pointerup") as unknown as PointerEvent));
  const draft = diffComposers.get(sessionId, diff.path)!;
  expect(draft.context).toMatchObject({ side: "new", startLine: 1, endLine: 2, currentVersion: diff.currentVersion });
  expect(draft.context.lines).toEqual([{ line: 1, text: "wrapped ".repeat(100) }, { line: 2, text: "new" }]);
});

test("pointer cancellation keeps the existing draft and allows another selection", async () => {
  await render();
  await act(() => button("Ask about or comment on old line 2").click());
  const original = diffComposers.get(sessionId, diff.path)!;
  await act(() => diffComposers.update(original.id, { text: "Keep this question" }));

  await pointer(button("Ask about or comment on new line 2"), "pointerdown");
  await pointer(window, "pointercancel");
  await pointer(window, "pointerup");
  expect(diffComposers.get(sessionId, diff.path)).toMatchObject({
    id: original.id,
    text: "Keep this question",
  });

  await pointer(button("Ask about or comment on new line 1"), "pointerdown");
  await pointer(window, "pointerup");
  expect(diffComposers.get(sessionId, diff.path)?.anchor).toEqual({ side: "RIGHT", line: 1 });
});

test("unmounting during a drag removes the pending pointer handlers", async () => {
  await render();
  await pointer(button("Ask about or comment on new line 2"), "pointerdown");
  await act(() => root.render(null));
  await pointer(window, "pointerup");
  expect(diffComposers.get(sessionId, diff.path)).toBeUndefined();
});

test("a composer stays visible when only its side's anchor disappears and returns inline once restored", async () => {
  await render();
  await act(() => button("Ask about or comment on old line 2").click());
  const draft = diffComposers.get(sessionId, diff.path)!;
  await act(() => diffComposers.update(draft.id, { text: "Explain this deletion" }));

  await act(() => client.setQueryData(["diff", sessionId, diff.path], {
    ...diff,
    hunks: diff.hunks.map((hunk) => ({
      ...hunk,
      lines: hunk.lines.filter((line) => line.kind !== "del"),
    })),
  }));
  await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  expect(button("Ask about or comment on new line 2")).toBeDefined();
  expect(container.querySelector('[data-current-version] form')).toBeNull();
  expect(container.querySelectorAll("form")).toHaveLength(1);
  expect(container.querySelector("textarea")?.value).toBe("Explain this deletion");
  expect(container.querySelector("pre")?.textContent).toBe("2: old");

  await act(() => client.setQueryData(["diff", sessionId, diff.path], diff));
  await act(() => new Promise(resolve => setTimeout(resolve, 10)));
  expect(container.querySelector('[data-current-version] form')).not.toBeNull();
  expect(container.querySelectorAll("form")).toHaveLength(1);
  expect(container.querySelector("textarea")?.value).toBe("Explain this deletion");
});
