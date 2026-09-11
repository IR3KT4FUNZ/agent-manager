import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PanelBoard, type PanelSpec } from "./PanelBoard";
import type { PanelId } from "../lib/panelOrder";

const browser = new Window({ url: "http://localhost" });
const globals = {
  window: browser,
  document: browser.document,
  localStorage: browser.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
};
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  for (const [name, value] of Object.entries(globals)) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
});

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

afterAll(async () => {
  await browser.happyDOM.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function panels(): PanelSpec[] {
  return ["sessions", "changes", "diff", "chat"].map((id) => ({
    id: id as PanelId,
    title: id,
    defaultWidth: 240,
    content: <div>{id} content</div>,
  }));
}

function panel(id: PanelId) {
  return container.querySelector<HTMLElement>(`[data-panel="${id}"]`)!;
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  expect(button).toBeDefined();
  await act(() => button!.click());
}

test("hiding and restoring preserves mounted content, state, and DOM order", async () => {
  let mounts = 0;
  let unmounts = 0;
  function Content() {
    const [count, setCount] = useState(0);
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
  }
  const specs = panels();
  specs[3].content = <Content />;
  await act(() => root.render(<PanelBoard panels={specs} />));
  const originalChat = panel("chat");
  const originalNodes = [...container.querySelectorAll("[data-panel]")];
  await click("Count 0");
  await click("chat");
  expect(originalChat.style.display).toBe("none");
  const toggle = container.querySelector('button[title="Show chat panel"]');
  expect(toggle?.getAttribute("aria-pressed")).toBe("false");
  await click("chat");
  expect(panel("chat")).toBe(originalChat);
  expect(originalChat.style.display).toBe("");
  expect(originalChat.textContent).toContain("Count 1");
  expect([...container.querySelectorAll("[data-panel]")]).toEqual(originalNodes);
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
});

test("visible panels fill the space and resize dividers skip hidden neighbors", async () => {
  localStorage.setItem("agent-manager.panel-widths", JSON.stringify({ sessions: 320 }));
  await act(() => root.render(<PanelBoard panels={panels()} />));
  await click("changes");
  await click("chat");
  expect(panel("diff").style.flexGrow).toBe("1");
  expect(panel("sessions").style.flexBasis).toBe("320px");
  const dividerSelector = '[title="Drag to resize · double-click to reset"]';
  const divider = panel("diff").querySelector(dividerSelector)!;
  await act(() => {
    divider.dispatchEvent(
      new browser.MouseEvent("dblclick", { bubbles: true }) as unknown as MouseEvent,
    );
  });
  expect(panel("sessions").style.flexBasis).toBe("240px");
  await click("sessions");
  expect(panel("diff").querySelector(dividerSelector)).toBeNull();
  await click("chat");
  expect(panel("chat").style.flexGrow).toBe("1");
  expect(panel("diff").style.flexBasis).toBe("240px");
});

test("all panels can be hidden, persisted across mounts, and restored from the toolbar", async () => {
  await act(() => root.render(<PanelBoard panels={panels()} />));
  for (const id of ["sessions", "changes", "diff", "chat"]) await click(id);
  expect(container.textContent).toContain("All panels are hidden");
  await act(() => root.unmount());
  root = createRoot(container);
  const withoutDiff = panels().filter((spec) => spec.id !== "diff");
  await act(() => root.render(<PanelBoard panels={withoutDiff} />));
  expect(container.textContent).toContain("All panels are hidden");
  await click("sessions");
  expect(panel("sessions").style.display).toBe("");
  await click("Show all");
  for (const node of container.querySelectorAll<HTMLElement>("[data-panel]")) {
    expect(node.style.display).toBe("");
  }
  expect(JSON.parse(localStorage.getItem("agent-manager.hidden-panels")!)).toEqual([]);
});

test("selecting a file reveals a hidden diff, including selecting the same file again", async () => {
  const specs = panels();
  specs[2].revealKey = { path: "file.ts" };
  await act(() => root.render(<PanelBoard panels={specs} />));
  await click("diff");
  await act(() => root.render(<PanelBoard panels={[...specs]} />));
  expect(panel("diff").style.display).toBe("none");
  specs[2] = { ...specs[2], revealKey: { path: "file.ts" } };
  await act(() => root.render(<PanelBoard panels={[...specs]} />));
  expect(panel("diff").style.display).toBe("");
  await click("diff");
  const withoutDiff = specs.filter((spec) => spec.id !== "diff");
  await act(() => root.render(<PanelBoard panels={withoutDiff} />));
  expect(container.querySelector('button[title="Show diff panel"]')).toBeNull();
  await act(() => root.render(<PanelBoard panels={specs} />));
  expect(panel("diff").style.display).toBe("");
});

test("malformed storage leaves the panels usable", async () => {
  localStorage.setItem("agent-manager.hidden-panels", "{");
  await act(() => root.render(<PanelBoard panels={panels()} />));
  expect(panel("sessions").style.display).toBe("");
  await click("sessions");
  expect(panel("sessions").style.display).toBe("none");
});
