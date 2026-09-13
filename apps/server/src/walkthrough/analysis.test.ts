import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { commitAll, removeTempDirs, tempRepo } from "../testRepo";
import { captureSnapshot, snapshotMatches } from "./snapshot";
import { analyzeDependencies } from "./analysis";
import { dependencyOrder } from "./graph";
import type { DependencyGraph } from "@agent-manager/shared";

afterEach(removeTempDirs);
const worktree = (root: string) => ({
  path: root,
  repoRoot: root,
  branch: "main",
});
function edge(graph: DependencyGraph, from: string, to: string, kind: string) {
  return graph.edges.find(
    (edge) =>
      graph.nodes.find((node) => node.id === edge.from)?.name === from &&
      graph.nodes.find((node) => node.id === edge.to)?.name === to &&
      edge.kind === kind &&
      edge.evidence.side === "new",
  );
}

test("worker resolves aliases, re-exports, JSX, methods, types and unchanged callers", async () => {
  const root = await tempRepo();
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
        jsx: "react-jsx",
      },
      include: ["src"],
    }),
  );
  writeFileSync(
    join(root, "src/helper.ts"),
    "export interface Options { value: number }\nexport function helper() { return 1; }\nexport class Service { run() { return helper(); } }\n",
  );
  writeFileSync(
    join(root, "src/barrel.ts"),
    "export { helper as answer, Service, type Options } from './helper';\n",
  );
  writeFileSync(
    join(root, "src/app.tsx"),
    "import { answer, Service, type Options } from '@/barrel';\nexport function Widget(options: Options) { return answer() + new Service().run(); }\nexport function App() { return <Widget value={1} />; }\n",
  );
  await commitAll(root, "initial");
  writeFileSync(
    join(root, "src/helper.ts"),
    "export interface Options { value: number }\nexport function helper() { return 2; }\nexport class Service { run() { return helper(); } }\n",
  );
  const snapshot = await captureSnapshot(worktree(root));
  const graph = await analyzeDependencies(snapshot);
  expect(edge(graph, "helper", "Widget", "call")?.evidence).toMatchObject({
    path: "src/app.tsx",
    line: 2,
  });
  expect(edge(graph, "run", "Widget", "call")).toBeDefined();
  expect(edge(graph, "Widget", "App", "jsx")).toBeDefined();
  expect(edge(graph, "Options", "Widget", "type")).toBeDefined();
  expect(
    graph.nodes.some((node) => node.name === "Widget" && !node.changed),
  ).toBe(true);
  expect(
    graph.nodes
      .filter((node) => node.name === "helper")
      .map((node) => node.side)
      .sort(),
  ).toEqual(["new", "old"]);
  const order = graph.groups.flat();
  expect(
    order.indexOf(edge(graph, "helper", "Widget", "call")!.from),
  ).toBeLessThan(order.indexOf(edge(graph, "helper", "Widget", "call")!.to));
});

test("base graph retains deleted declarations and current graph distinguishes shadowed functions and callbacks", async () => {
  const root = await tempRepo();
  writeFileSync(
    join(root, "removed.ts"),
    "export function gone() { return 1; }\n",
  );
  writeFileSync(
    join(root, "main.ts"),
    "import { gone } from './removed';\nexport function consumer() { return gone(); }\n",
  );
  await commitAll(root, "before");
  unlinkSync(join(root, "removed.ts"));
  writeFileSync(
    join(root, "main.ts"),
    "function same() { return 1; }\nfunction first() { function same() { return 2; } return same(); }\nfunction second(callback: () => void) { callback(); return same(); }\n",
  );
  writeFileSync(join(root, "note.py"), "print('hello')\n");
  const graph = await analyzeDependencies(
    await captureSnapshot(worktree(root)),
  );
  expect(graph.nodes.find((node) => node.name === "gone")).toMatchObject({
    side: "old",
    changed: true,
  });
  const sameNodes = graph.nodes.filter(
    (node) => node.name === "same" && node.side === "new",
  );
  expect(sameNodes).toHaveLength(2);
  const first = edge(graph, "same", "first", "call")!;
  const second = edge(graph, "same", "second", "call")!;
  expect(first.from).not.toBe(second.from);
  expect(
    graph.edges.some(
      (edge) =>
        edge.kind === "call" &&
        graph.nodes.find((node) => node.id === edge.from)?.name === "callback",
    ),
  ).toBe(false);
  expect(graph.limitations.some((text) => text.includes("Dynamic calls"))).toBe(
    true,
  );
  expect(graph.limitations.some((text) => text.includes("note.py"))).toBe(true);
});

test("cycles are grouped and independent prerequisites are ordered stably", () => {
  const edges = [
    { from: "a", to: "b" },
    { from: "b", to: "a" },
    { from: "b", to: "c" },
  ];
  expect(dependencyOrder(["c", "b", "a"], edges)).toEqual([["a", "b"], ["c"]]);
  expect(dependencyOrder(["a", "b", "c"], [...edges].reverse())).toEqual([
    ["a", "b"],
    ["c"],
  ]);
});

test("snapshot checks detect changed dependencies and analysis can be cancelled", async () => {
  const root = await tempRepo();
  writeFileSync(join(root, "helper.js"), "export const value = 1;\n");
  await commitAll(root, "base");
  writeFileSync(
    join(root, "use.js"),
    "import { value } from './helper';\nexport const answer = value;\n",
  );
  const snapshot = await captureSnapshot(worktree(root));
  expect(await snapshotMatches(snapshot, worktree(root))).toBe(true);
  writeFileSync(join(root, "helper.js"), "export const value = 2;\n");
  expect(await snapshotMatches(snapshot, worktree(root))).toBe(false);
  const controller = new AbortController();
  const pending = analyzeDependencies(snapshot, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
});

test("project references and extended alias configurations resolve cross-project prerequisites", async () => {
  const root = await tempRepo();
  mkdirSync(join(root, "lib"));
  mkdirSync(join(root, "app"));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      files: [],
      references: [{ path: "./lib" }, { path: "./app" }],
    }),
  );
  writeFileSync(
    join(root, "settings.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { library: ["lib/helper.ts"] } },
    }),
  );
  writeFileSync(
    join(root, "lib/tsconfig.json"),
    JSON.stringify({ compilerOptions: { composite: true }, include: ["*.ts"] }),
  );
  writeFileSync(
    join(root, "app/tsconfig.json"),
    JSON.stringify({
      extends: "../settings.json",
      references: [{ path: "../lib" }],
      include: ["*.ts"],
    }),
  );
  writeFileSync(
    join(root, "lib/helper.ts"),
    "export function helper() { return 1; }\n",
  );
  writeFileSync(
    join(root, "app/use.ts"),
    "import { helper } from 'library';\nexport function use() { return helper(); }\n",
  );
  await commitAll(root, "projects");
  writeFileSync(
    join(root, "lib/helper.ts"),
    "export function helper() { return 2; }\n",
  );
  const graph = await analyzeDependencies(
    await captureSnapshot(worktree(root)),
  );
  expect(edge(graph, "helper", "use", "call")?.evidence.path).toBe(
    "app/use.ts",
  );
});

test("recursive declarations retain their cycle and analysis budgets expose omitted changed files", async () => {
  const root = await tempRepo();
  writeFileSync(
    join(root, "recursive.ts"),
    "export function a() { return b(); }\nexport function b() { return a(); }\n",
  );
  let graph = await analyzeDependencies(await captureSnapshot(worktree(root)));
  const cycle = graph.groups.find((group) => group.length === 2)!;
  expect(
    cycle.map((id) => graph.nodes.find((node) => node.id === id)?.name).sort(),
  ).toEqual(["a", "b"]);
  writeFileSync(
    join(root, "many.ts"),
    Array.from(
      { length: 220 },
      (_, index) => `export const value${index} = ${index};`,
    ).join("\n"),
  );
  graph = await analyzeDependencies(await captureSnapshot(worktree(root)));
  expect(graph.nodes.length).toBe(200);
  expect(graph.omittedPaths).toContain("many.ts");
  expect(
    graph.limitations.some((text) => text.includes("200-node budget")),
  ).toBe(true);
});

test("polymorphic method dispatch is a reference rather than a confirmed runtime call", async () => {
  const root = await tempRepo();
  writeFileSync(
    join(root, "dispatch.ts"),
    "export class Base { run() { return 1; } }\nexport function invoke(service: Base) { return service.run(); }\n",
  );
  const graph = await analyzeDependencies(
    await captureSnapshot(worktree(root)),
  );
  expect(edge(graph, "run", "invoke", "reference")).toBeDefined();
  expect(edge(graph, "run", "invoke", "call")).toBeUndefined();
});
