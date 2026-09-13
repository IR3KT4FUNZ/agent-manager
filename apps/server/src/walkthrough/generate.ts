import type {
  DependencyGraph,
  Walkthrough,
  WalkthroughReference,
  WalkthroughStep,
} from "@agent-manager/shared";
import type { AnalysisSnapshot } from "./snapshot";
import { dependencyOrder } from "./graph";

const string = { type: "string" };
const nodeIds = { type: "array", items: string };
export const walkthroughSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: string,
          explanation: string,
          details: string,
          example: string,
          reviewConsiderations: string,
          nodeIds,
        },
        required: [
          "title",
          "explanation",
          "details",
          "example",
          "reviewConsiderations",
          "nodeIds",
        ],
      },
    },
    impact: {
      type: "object",
      additionalProperties: false,
      properties: { explanation: string, nodeIds },
      required: ["explanation", "nodeIds"],
    },
  },
  required: ["steps", "impact"],
};
interface GeneratedStep {
  title: string;
  explanation: string;
  details: string;
  example: string;
  reviewConsiderations: string;
  nodeIds: string[];
}
interface GeneratedTour {
  steps: GeneratedStep[];
  impact: { explanation: string; nodeIds: string[] };
}

export function generationPrompt(
  snapshot: AnalysisSnapshot,
  graph: DependencyGraph,
  description: string,
) {
  const prompt = [
    "Create a guided walkthrough of these changes. Explain foundations/helpers first, then their callers and use cases, then overall impact. Cluster related base/current nodes when useful. Use the supplied dependency evidence; do not invent edges or node IDs. Distinguish static references from definite calls and label inferred intent. Include unchanged connecting code when it helps. Prefer 4–12 concise steps, fewer for small changes. Do not number step titles. Cover every changed node where practical. Details and behavior examples can be empty when unhelpful. State analysis limitations. The final impact must cite supplied node IDs. Do not edit code.",
    JSON.stringify({
      description,
      base: snapshot.base,
      head: snapshot.head,
      graph: {
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          excerpt: node.excerpt
            .slice(0, 1800)
            .split("\n")
            .map((line, index) => `${node.line + index}: ${line}`)
            .join("\n"),
          excerptTruncated:
            node.excerpt.length > 1800 ||
            node.endLine - node.line + 1 > node.excerpt.split("\n").length,
        })),
      },
      diffs: snapshot.diffs,
    }),
  ].join("\n");
  if (Buffer.byteLength(prompt) > 1024 * 1024)
    throw new Error(
      "This walkthrough exceeds the 1 MiB context budget. Review a smaller set of changes.",
    );
  return prompt;
}

export function buildWalkthrough(
  value: unknown,
  snapshot: AnalysisSnapshot,
  graph: DependencyGraph,
): Walkthrough {
  const tour = value as GeneratedTour;
  if (
    !tour ||
    !Array.isArray(tour.steps) ||
    tour.steps.length < 1 ||
    tour.steps.length > 80 ||
    !tour.impact ||
    typeof tour.impact.explanation !== "string"
  )
    throw new Error("The agent returned an invalid walkthrough.");
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const membership = new Map<string, string>();
  function validateNodes(ids: unknown): asserts ids is string[] {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.some((id) => typeof id !== "string" || !nodes.has(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error(
        "The walkthrough references unknown or duplicate code nodes.",
      );
    }
  }
  function reference(id: string): WalkthroughReference {
    const node = nodes.get(id)!;
    const diff = snapshot.diffs.find(
      (diff) =>
        (node.side === "old" ? (diff.oldPath ?? diff.path) : diff.path) ===
        node.path,
    );
    const lines =
      diff?.hunks
        .flatMap((hunk) => hunk.lines)
        .map((line) => (node.side === "old" ? line.oldLine : line.newLine))
        .filter(
          (line): line is number =>
            line !== null && line >= node.line && line <= node.endLine,
        ) ?? [];
    return {
      path: node.path,
      side: node.side,
      line: node.line,
      endLine: node.endLine,
      version: node.version,
      nodeId: id,
      ...(lines.length
        ? {
            diffPath: diff!.path,
            diffLine: Math.min(...lines),
            diffEndLine: Math.max(...lines),
            currentVersion: diff!.currentVersion,
            baseVersion: snapshot.base,
          }
        : {}),
    };
  }
  const steps = new Map<string, GeneratedStep>();
  tour.steps.forEach((step, index) => {
    if (
      !step ||
      [
        step.title,
        step.explanation,
        step.details,
        step.example,
        step.reviewConsiderations,
      ].some((text) => typeof text !== "string") ||
      !step.title.trim() ||
      !step.explanation.trim()
    )
      throw new Error("The walkthrough contains an invalid step.");
    validateNodes(step.nodeIds);
    const id = `step-${index + 1}`;
    for (const node of step.nodeIds) {
      if (membership.has(node))
        throw new Error(
          "A code node belongs to more than one walkthrough step.",
        );
      membership.set(node, id);
    }
    steps.set(id, step);
  });
  validateNodes(tour.impact.nodeIds);
  const edges = graph.edges.flatMap((edge) => {
    const from = membership.get(edge.from);
    const to = membership.get(edge.to);
    return from && to && from !== to ? [{ from, to }] : [];
  });
  const groups = dependencyOrder([...steps.keys()], edges);
  const mergedIds = new Map(
    groups.flatMap((group) => group.map((id) => [id, group[0]!] as const)),
  );
  const ordered: WalkthroughStep[] = groups.map((group) => {
    const members = group.map((id) => steps.get(id)!);
    const ids = members.flatMap((step) => step.nodeIds);
    return {
      id: group[0]!,
      title: members
        .map((step) => step.title.replace(/^\s*\d+[.)]\s*/, ""))
        .join(" / "),
      explanation: members.map((step) => step.explanation).join("\n\n"),
      details: members
        .map((step) => step.details)
        .filter(Boolean)
        .join("\n\n"),
      example: members
        .map((step) => step.example)
        .filter(Boolean)
        .join("\n\n"),
      reviewConsiderations: members
        .map((step) => step.reviewConsiderations)
        .filter(Boolean)
        .join("\n\n"),
      nodeIds: ids,
      references: ids
        .map(reference)
        .sort((a, b) => Number(b.side === "new") - Number(a.side === "new")),
      prerequisites: [
        ...new Set(
          edges
            .filter(
              (edge) => group.includes(edge.to) && !group.includes(edge.from),
            )
            .map((edge) => mergedIds.get(edge.from)!),
        ),
      ].sort(),
    };
  });
  ordered.push({
    id: "impact",
    title: "Overall impact",
    explanation: tour.impact.explanation,
    details: "",
    example: "",
    reviewConsiderations: "",
    nodeIds: tour.impact.nodeIds,
    references: tour.impact.nodeIds.map(reference),
    prerequisites: ordered.map((step) => step.id),
  });
  const uncoveredFiles = snapshot.changedPaths.filter((path) => {
    if (graph.omittedPaths?.includes(path)) return true;
    const diff = snapshot.diffs.find((diff) => diff.path === path);
    const changed = graph.nodes.filter(
      (node) =>
        node.changed && (node.path === path || node.path === diff?.oldPath),
    );
    return !changed.length || changed.some((node) => !membership.has(node.id));
  });
  return {
    version: crypto.randomUUID(),
    snapshotVersion: snapshot.version,
    base: snapshot.base,
    head: snapshot.head,
    steps: ordered,
    uncoveredFiles,
    limitations: graph.limitations,
  };
}

export function dependentSteps(
  steps: WalkthroughStep[],
  initial: Set<string>,
): string[] {
  const stale = new Set(initial);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps)
      if (
        !stale.has(step.id) &&
        step.prerequisites.some((id) => stale.has(id))
      ) {
        stale.add(step.id);
        changed = true;
      }
  }
  return steps.filter((step) => stale.has(step.id)).map((step) => step.id);
}
