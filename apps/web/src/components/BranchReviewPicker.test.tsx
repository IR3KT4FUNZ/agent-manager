import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BranchReviewRequest } from "@agent-manager/shared";
import { BranchReviewPicker } from "./BranchReviewPicker";

const browser = new Window({ url: "http://localhost" });
const globals = { window: browser, document: browser.document, IS_REACT_ACT_ENVIRONMENT: true };
const previous = new Map<string, PropertyDescriptor | undefined>();
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let opened: BranchReviewRequest[];
let cancelled: boolean;

beforeAll(() => {
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(["branches", "project"], {
    branches: ["main", "feature", "review-branch-diffs", "origin/release"], currentBranch: "main", defaultBase: "main",
  });
  opened = [];
  cancelled = false;
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  client.clear();
});
afterAll(async () => {
  await browser.happyDOM.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function render(pending = false) {
  await act(() => root.render(
    <QueryClientProvider client={client}>
      <BranchReviewPicker projectId="project" pending={pending}
        onOpen={(review) => opened.push(review)} onCancel={() => { cancelled = true; }} />
    </QueryClientProvider>,
  ));
}

async function select(input: HTMLSelectElement, value: string) {
  await act(() => {
    input.value = value;
    input.dispatchEvent(new browser.Event("change", { bubbles: true }) as unknown as Event);
  });
}
async function submit() {
  await act(() => container.querySelector("form")!.dispatchEvent(
    new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event,
  ));
}
async function change(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.assign(input, { attachEvent() {}, detachEvent() {} });
    input.dispatchEvent(new browser.FocusEvent("focusin", { bubbles: true }) as unknown as Event);
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event);
    input.dispatchEvent(new browser.KeyboardEvent("keyup", { bubbles: true }) as unknown as Event);
  });
}

test("branch dropdown lists all branches even when main is selected and accepts a fetched base", async () => {
  await render();
  const [head, base] = [...container.querySelectorAll("select")];
  expect(head!.value).toBe("main");
  expect(base!.value).toBe("main");
  expect([...head!.options].map((option) => option.value))
    .toEqual(["", "main", "feature", "review-branch-diffs", "origin/release", "HEAD", ":"]);
  await select(head!, "review-branch-diffs");
  await select(base!, "origin/release");
  await submit();
  expect(opened).toEqual([{ headRef: "review-branch-diffs", baseRef: "origin/release" }]);
  expect(container.textContent).not.toContain("GitHub");
});

test("empty or pending selections cannot submit, and the picker can be cancelled", async () => {
  await render();
  await select(container.querySelector("select")!, ":");
  const head = container.querySelector("input")!;
  await change(head, "   ");
  await submit();
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await change(head, "feature");
  await render(true);
  await submit();
  expect(opened).toEqual([]);
  expect(head.disabled).toBe(true);
  await render();
  await act(() => container.querySelector<HTMLButtonElement>('button[type="button"]')!.click());
  expect(cancelled).toBe(true);
});

test("custom refs can be entered and switched back to a listed branch", async () => {
  await render();
  const head = container.querySelector("select")!;
  await select(head, ":");
  await change(container.querySelector("input")!, " HEAD~2 ");
  await submit();
  expect(opened).toEqual([{ headRef: "HEAD~2", baseRef: "main" }]);
  await select(head, "feature");
  expect(container.querySelector("input")).toBeNull();
  await submit();
  expect(opened.at(-1)).toEqual({ headRef: "feature", baseRef: "main" });
});
