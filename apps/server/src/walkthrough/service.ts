import type {
  ReviewRequest,
  SourceDocument,
  Walkthrough,
  WalkthroughReference,
  WalkthroughState,
  WorktreeInfo,
} from "@agent-manager/shared";
import type { ReviewAssistant } from "../review/assistant";
import { QuestionError } from "../questions";
import { contentVersion, readSource } from "../source";
import { resolveBaseRef } from "../changes";
import { runGit } from "../worktrees";
import { runGhJson } from "../github";
import {
  captureSnapshot,
  snapshotMatches,
  type AnalysisSnapshot,
} from "./snapshot";
import { analyzeDependencies } from "./analysis";
import {
  buildWalkthrough,
  dependentSteps,
  generationPrompt,
  walkthroughSchema,
} from "./generate";

export class WalkthroughService {
  private walkthrough: Walkthrough | null = null;
  private snapshot?: AnalysisSnapshot;
  private phase: WalkthroughState["phase"] = "idle";
  private staleSteps: string[] = [];
  private stale = false;
  private checkedAt = 0;
  private pendingCheck?: Promise<void>;

  constructor(
    private assistant: ReviewAssistant,
    private worktree: WorktreeInfo | undefined,
    private target: () => string | undefined,
    private prNumber: () => number | undefined,
  ) {
    assistant.setStepContext((request) => this.stepContext(request));
  }
  generate(requestId: string) {
    if (!/^[\w-]{1,100}$/.test(requestId))
      throw new QuestionError("Invalid walkthrough request ID.");
    if (!this.worktree)
      throw new QuestionError("Open a git session to generate a walkthrough.");
    const worktree = this.worktree;
    return this.assistant.enqueue(
      { requestId, question: "Generate a code walkthrough" },
      "walkthrough",
      async (signal, turn) => {
        try {
          this.phase = "capturing";
          const snapshot = await captureSnapshot(
            worktree,
            this.target(),
            signal,
          );
          if (!snapshot.changedPaths.length)
            throw new Error("There are no changes to walk through.");
          this.phase = "analyzing";
          const graph = await analyzeDependencies(snapshot, signal);
          if (!graph.nodes.length)
            throw new Error(
              "No readable code was available for this walkthrough. Review the changed files directly.",
            );
          let description = "";
          const number = this.prNumber();
          if (number) {
            try {
              const pr = await runGhJson<{ title: string; body: string }>(
                ["pr", "view", String(number), "--json", "title,body"],
                worktree.repoRoot,
              );
              description = `${pr.title}\n${pr.body}`;
            } catch {
              graph.limitations.push(
                "PR description unavailable; walkthrough uses local code evidence.",
              );
            }
          }
          signal.throwIfAborted();
          this.phase = "explaining";
          const result = await turn(
            generationPrompt(snapshot, graph, description),
            walkthroughSchema,
          );
          signal.throwIfAborted();
          if (!(await snapshotMatches(snapshot, worktree, this.target())))
            throw new Error(
              "Code changed while generating. Generate the walkthrough again.",
            );
          this.walkthrough = buildWalkthrough(result, snapshot, graph);
          this.snapshot = snapshot;
          this.staleSteps = [];
          this.stale = false;
          this.checkedAt = Date.now();
        } finally {
          this.phase = "idle";
        }
      },
    );
  }
  async state(): Promise<WalkthroughState> {
    await this.checkFreshness();
    return {
      walkthrough: this.walkthrough,
      phase: this.phase,
      stale: this.stale,
      staleSteps: this.staleSteps,
    };
  }
  async resolveReference(
    version: string,
    nodeId: string,
  ): Promise<WalkthroughReference> {
    await this.checkFreshness(true);
    if (!this.walkthrough || version !== this.walkthrough.version)
      throw new QuestionError(
        "This walkthrough was replaced. Select a step from the current walkthrough.",
        409,
      );
    const step = this.walkthrough.steps.find((step) =>
      step.nodeIds.includes(nodeId),
    );
    const reference = step?.references.find(
      (reference) => reference.nodeId === nodeId,
    );
    if (!step || !reference)
      throw new QuestionError("Walkthrough reference not found.", 404);
    if (this.staleSteps.includes(step.id))
      throw new QuestionError(
        "This code changed. Regenerate the walkthrough before opening its highlights.",
        409,
      );
    return reference;
  }
  async source(version: string, nodeId: string): Promise<SourceDocument> {
    const reference = await this.resolveReference(version, nodeId);
    const content = (
      reference.side === "old" ? this.snapshot!.before : this.snapshot!.after
    )[reference.path];
    if (content === undefined || contentVersion(content) !== reference.version)
      throw new QuestionError("Walkthrough source unavailable.", 404);
    return {
      path: reference.path,
      content,
      version: reference.version,
      language: /\.[cm]?tsx?$/.test(reference.path)
        ? "typescript"
        : /\.[cm]?jsx?$/.test(reference.path)
          ? "javascript"
          : "plaintext",
    };
  }
  private async stepContext(request: ReviewRequest) {
    if (!request.stepId) return undefined;
    await this.checkFreshness(true);
    const step = this.walkthrough?.steps.find(
      (step) => step.id === request.stepId,
    );
    if (!step || this.walkthrough?.version !== request.walkthroughVersion)
      throw new QuestionError(
        "This walkthrough was replaced. Select the step again.",
        409,
      );
    if (request.mode === "change" && this.staleSteps.includes(step.id))
      throw new QuestionError(
        "This step is outdated. Regenerate before requesting a change.",
        409,
      );
    const prompt = JSON.stringify({
      step,
      outdated: this.staleSteps.includes(step.id),
      selectedCode: step.references.map((reference) => ({
        ...reference,
        text: (reference.side === "old"
          ? this.snapshot!.before
          : this.snapshot!.after)[reference.path]
          ?.split("\n")
          .slice(reference.line - 1, reference.endLine)
          .join("\n")
          .slice(0, 6000),
      })),
    });
    return {
      prompt,
      context: {
        title: step.title,
        explanation: step.explanation,
        references: step.references,
      },
    };
  }
  private async checkFreshness(force = false) {
    if (!this.snapshot || !this.walkthrough || !this.worktree) return;
    if (this.pendingCheck) return this.pendingCheck;
    if (!force && Date.now() - this.checkedAt < 2500) return;
    const snapshot = this.snapshot;
    const walkthrough = this.walkthrough;
    const worktree = this.worktree;
    this.pendingCheck = (async () => {
      const changed = new Set<string>();
      for (const path of Object.keys(snapshot.after)) {
        const source = await readSource(worktree.path, path).catch(() => null);
        if (source?.version !== contentVersion(snapshot.after[path]!))
          changed.add(path);
      }
      const baseChanged =
        (await resolveBaseRef(worktree, this.target())) !== snapshot.base;
      const headChanged =
        (await runGit(["rev-parse", "HEAD"], worktree.path)).stdout !==
        snapshot.head;
      const stale = new Set(
        walkthrough.steps
          .filter(
            (step) =>
              baseChanged ||
              headChanged ||
              step.references.some((reference) => changed.has(reference.path)),
          )
          .map((step) => step.id),
      );
      const matches = await snapshotMatches(snapshot, worktree, this.target());
      if (this.walkthrough !== walkthrough) return;
      this.stale = !matches;
      this.staleSteps = dependentSteps(walkthrough.steps, stale);
      if (!matches && !this.staleSteps.length)
        this.staleSteps = walkthrough.steps.map((step) => step.id);
      this.checkedAt = Date.now();
    })().finally(() => {
      this.pendingCheck = undefined;
    });
    return this.pendingCheck;
  }
}
