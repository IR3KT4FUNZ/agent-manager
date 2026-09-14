import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Walkthrough, WalkthroughReference } from "@agent-manager/shared";
import { WalkthroughSteps } from "./WalkthroughPanel";
import { useCodeHistory } from "../lib/codeHistory";

const browser = new Window({ url: "http://localhost" });
const originalFetch = globalThis.fetch;
const previous = new Map<string, PropertyDescriptor | undefined>();
const reference: WalkthroughReference = {
  nodeId: "helper",
  path: "helper.ts",
  side: "new",
  line: 1,
  endLine: 3,
  version: "source-version",
};
const walkthrough: Walkthrough = {
  version: "tour-version",
  snapshotVersion: "snapshot",
  base: "base",
  head: "head",
  uncoveredFiles: ["image.png"],
  limitations: ["Binary content was omitted."],
  steps: [
    {
      id: "helper",
      title: "Selection helper",
      explanation: "Capture the selected range.",
      details: "Pointer details",
      example: "Drag two lines.",
      reviewConsiderations: "Check cancellation",
      nodeIds: ["helper"],
      prerequisites: [],
      references: [reference],
    },
    {
      id: "consumer",
      title: "Connect the viewer",
      explanation: "The viewer uses the helper.",
      details: "",
      example: "",
      reviewConsiderations: "",
      nodeIds: ["consumer"],
      prerequisites: ["helper"],
      references: [{ ...reference, nodeId: "consumer", path: "viewer.tsx" }],
    },
  ],
};
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let sessionId: string;
function HistoryProbe() {
  const { current, history } = useCodeHistory(sessionId);
  return (
    <>
      <output>{current?.path}</output>
      <button
        onClick={() => history.visit({ mode: "source", path: "other.ts" })}
      >
        Explore elsewhere
      </button>
    </>
  );
}
beforeAll(() => {
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    localStorage: browser.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
});
beforeEach(() => {
  sessionId = crypto.randomUUID();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({
    defaultOptions: {
      queries: { enabled: false, retry: false, staleTime: Infinity },
    },
  });
  client.setQueryData(["review", sessionId], {
    selection: { agent: "codex" },
    jobs: [],
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const nodeId = decodeURIComponent(
      String(input).split("/reference/")[1]!.split("?")[0]!,
    );
    return Response.json(
      walkthrough.steps
        .flatMap((step) => step.references)
        .find((reference) => reference.nodeId === nodeId),
    );
  }) as unknown as typeof fetch;
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  client.clear();
  globalThis.fetch = originalFetch;
});
afterAll(async () => {
  await browser.happyDOM.close();
  for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function render(tour = walkthrough, staleSteps: string[] = []) {
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <WalkthroughSteps
          key={tour.version}
          sessionId={sessionId}
          walkthrough={tour}
          state={{ staleSteps }}
        />
        <HistoryProbe />
      </QueryClientProvider>,
    ),
  );
}
function button(text: string) {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  )!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
    await Promise.resolve();
  });
}

test("step navigation and return preserve explicit progress across remounts, while regeneration resets it", async () => {
  await render();
  await click("1. Selection helper");
  expect(container.querySelector("output")?.textContent).toBe("helper.ts");
  expect(button("1. Selection helper").textContent).toContain("unreviewed");
  await click("Explore elsewhere");
  await click("Return to step");
  expect(container.querySelector("output")?.textContent).toBe("helper.ts");
  await click("Mark reviewed & next");
  expect(button("1. Selection helper").textContent).toContain("reviewed");
  expect(container.querySelector("output")?.textContent).toBe("viewer.tsx");
  await click("Revisit");
  await act(() => root.render(null));
  await render();
  expect(button("2. Connect the viewer").textContent).toContain("revisit");
  expect(
    JSON.parse(
      localStorage.getItem("agent-manager.walkthrough-progress.tour-version")!,
    ),
  ).toEqual({ helper: "reviewed", consumer: "revisit" });
  await click("image.png");
  expect(container.querySelector("output")?.textContent).toBe("image.png");
  await render({ ...walkthrough, version: "regenerated" });
  expect(button("1. Selection helper").textContent).toContain("unreviewed");
});

test("stale references cannot navigate or request edits, and late responses cannot reopen code after unmount", async () => {
  await render(walkthrough, ["helper"]);
  expect(button("Return to step").disabled).toBe(true);
  expect(button("Mark reviewed & next").disabled).toBe(true);
  expect(container.textContent).toContain("This step is outdated");
  await render();
  globalThis.fetch = (async () =>
    Response.json(
      { error: "Code changed. Regenerate." },
      { status: 409 },
    )) as unknown as typeof fetch;
  await click("Return to step");
  expect(container.textContent).toContain("Code changed. Regenerate.");
  expect(container.querySelector("output")?.textContent).toBe("");
  let resolve!: (response: Response) => void;
  globalThis.fetch = (() =>
    new Promise<Response>((done) => {
      resolve = done;
    })) as unknown as typeof fetch;
  await act(() => button("Return to step").click());
  await act(() => root.render(null));
  await act(async () => {
    resolve(Response.json(reference));
    await Promise.resolve();
  });
  await render();
  expect(container.querySelector("output")?.textContent).toBe("");
});
