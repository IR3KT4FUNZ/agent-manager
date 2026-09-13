import { expect, test } from "bun:test";
import type { DependencyGraph } from "@agent-manager/shared";
import { buildWalkthrough, dependentSteps } from "./generate";
import type { AnalysisSnapshot } from "./snapshot";

const snapshot: AnalysisSnapshot = {
  root: "/repo",
  base: "base",
  head: "head",
  version: "snapshot",
  before: {},
  after: {},
  diffs: [],
  changedPaths: ["a.ts", "b.ts", "c.ts", "image.png"],
  limitations: [],
};
const graph: DependencyGraph = {
  nodes: ["a", "b", "c"].map((id) => ({
    id,
    name: id,
    path: `${id}.ts`,
    line: 1,
    endLine: 2,
    version: "v",
    side: "new",
    changed: true,
    excerpt: "code",
  })),
  edges: [
    {
      from: "a",
      to: "b",
      kind: "call",
      evidence: {
        path: "b.ts",
        side: "new",
        line: 1,
        endLine: 1,
        version: "v",
      },
    },
    {
      from: "b",
      to: "c",
      kind: "call",
      evidence: {
        path: "c.ts",
        side: "new",
        line: 1,
        endLine: 1,
        version: "v",
      },
    },
  ],
  groups: [["a"], ["b"], ["c"]],
  limitations: ["Binary file"],
};
const step = (nodeIds: string[]) => ({
  title: nodeIds.join("+"),
  explanation: "Explanation",
  details: "Details",
  example: "Example",
  reviewConsiderations: "Check callers",
  nodeIds,
});
const tour = (steps: ReturnType<typeof step>[]) => ({
  steps,
  impact: { explanation: "Impact", nodeIds: ["c"] },
});

test("agent ordering is corrected using evidence, with explicit uncovered files and linked impact", () => {
  const result = buildWalkthrough(
    tour([step(["c"]), step(["b"]), step(["a"])]),
    snapshot,
    graph,
  );
  expect(result.steps.map((step) => step.title)).toEqual([
    "a",
    "b",
    "c",
    "Overall impact",
  ]);
  expect(result.steps[1]?.prerequisites).toEqual([result.steps[0]!.id]);
  expect(result.steps.at(-1)?.prerequisites).toHaveLength(3);
  expect(result.uncoveredFiles).toEqual(["image.png"]);
  expect(dependentSteps(result.steps, new Set([result.steps[1]!.id]))).toEqual(
    result.steps.slice(1).map((step) => step.id),
  );
});

test("clustering that introduces a cycle merges groups rather than inventing an order", () => {
  const result = buildWalkthrough(
    tour([step(["a", "c"]), step(["b"])]),
    snapshot,
    graph,
  );
  expect(result.steps).toHaveLength(2);
  expect(new Set(result.steps[0]?.nodeIds)).toEqual(new Set(["a", "b", "c"]));
});

test("unknown nodes, duplicate membership and malformed explanations are rejected", () => {
  for (const value of [
    tour([step(["unknown"])]),
    tour([step(["a"]), step(["a"])]),
    { steps: [] },
    tour([{ ...step(["a"]), explanation: "" }]),
  ]) {
    expect(() => buildWalkthrough(value, snapshot, graph)).toThrow();
  }
  expect(
    buildWalkthrough(tour([step(["c"])]), snapshot, graph).uncoveredFiles,
  ).toEqual(["a.ts", "b.ts", "image.png"]);
});
