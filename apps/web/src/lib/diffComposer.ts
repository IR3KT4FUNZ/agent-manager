import { useSyncExternalStore } from "react";
import type {
  AskAgentRequest,
  AskAgentResult,
  DiffSelectionContext,
  FileDiff,
  PrSide,
} from "@agent-manager/shared";
import { askAgent } from "./api";

export interface SelectionAnchor {
  side: PrSide;
  line: number;
  startLine?: number;
}

export interface ComposerDraft {
  id: string;
  sessionId: string;
  path: string;
  anchor: SelectionAnchor;
  context: DiffSelectionContext;
  destination: "agent" | "github";
  text: string;
  requestId: string;
  pending: boolean;
  error?: string;
}

export function captureDiffContext(diff: FileDiff, anchor: SelectionAnchor): DiffSelectionContext {
  const side = anchor.side === "LEFT" ? "old" : "new";
  const startLine = anchor.startLine ?? anchor.line;
  const lines = diff.hunks
    .flatMap((hunk) => hunk.lines)
    .flatMap((diffLine) => {
      const line = side === "old" ? diffLine.oldLine : diffLine.newLine;
      if (line === null || line < startLine || line > anchor.line) return [];
      return [{ line, text: diffLine.text }];
    });
  return {
    path: side === "old" ? diff.oldPath ?? diff.path : diff.path,
    side,
    startLine,
    endLine: anchor.line,
    lines,
    reviewHeadSha: diff.reviewHeadSha,
    base: diff.base,
    currentVersion: diff.currentVersion,
    selectedAt: new Date().toISOString(),
  };
}

export function contextPreview(context: DiffSelectionContext): string {
  let previousLine = context.startLine - 1;
  return context.lines
    .flatMap(({ line, text }) => {
      const gap = line > previousLine + 1 ? ["… intervening lines not displayed …"] : [];
      previousLine = line;
      return [...gap, `${line}: ${text}`];
    })
    .join("\n");
}

export class DiffComposerStore {
  private drafts = new Map<string, ComposerDraft>();
  private active = new Map<string, string>();
  private focus = new Map<string, number>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private fileKey(sessionId: string, path: string) {
    return JSON.stringify([sessionId, path]);
  }

  get(sessionId: string, path: string) {
    const activeId = this.active.get(this.fileKey(sessionId, path));
    return this.drafts.get(activeId ?? "");
  }

  focusKey(sessionId: string) {
    return this.focus.get(sessionId) ?? 0;
  }

  open(sessionId: string, diff: FileDiff, anchor: SelectionAnchor) {
    const id = JSON.stringify([sessionId, diff.path, anchor.side, anchor.startLine ?? anchor.line, anchor.line]);
    if (!this.drafts.has(id)) {
      this.drafts.set(id, {
        id,
        sessionId,
        path: diff.path,
        anchor,
        context: captureDiffContext(diff, anchor),
        destination: "agent",
        text: "",
        requestId: crypto.randomUUID(),
        pending: false,
      });
    }
    this.active.set(this.fileKey(sessionId, diff.path), id);
    this.emit();
  }

  update(id: string, patch: Partial<Pick<ComposerDraft, "text" | "destination">>) {
    const draft = this.drafts.get(id);
    if (!draft || draft.pending) return;
    const textChanged = patch.text !== undefined && patch.text !== draft.text;
    this.drafts.set(id, {
      ...draft,
      ...patch,
      error: undefined,
      requestId: textChanged ? crypto.randomUUID() : draft.requestId,
    });
    this.emit();
  }

  cancel(id: string) {
    const draft = this.drafts.get(id);
    if (!draft || draft.pending) return;
    this.remove(draft);
  }

  private remove(draft: ComposerDraft) {
    this.drafts.delete(draft.id);
    const key = this.fileKey(draft.sessionId, draft.path);
    if (this.active.get(key) === draft.id) this.active.delete(key);
    this.emit();
  }

  async send(
    id: string,
    deliver: (sessionId: string, request: AskAgentRequest) => Promise<AskAgentResult> = askAgent,
  ) {
    const draft = this.drafts.get(id);
    if (!draft || draft.pending || draft.destination !== "agent" || !draft.text.trim()) return;
    this.drafts.set(id, { ...draft, pending: true, error: undefined });
    this.emit();
    try {
      await deliver(draft.sessionId, {
        requestId: draft.requestId,
        question: draft.text,
        context: draft.context,
      });
      this.focus.set(draft.sessionId, this.focusKey(draft.sessionId) + 1);
      this.remove(draft);
    } catch (error) {
      this.drafts.set(id, {
        ...draft,
        pending: false,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit();
    }
  }
}

export const diffComposers = new DiffComposerStore();

export function useDiffComposer(sessionId: string, path: string) {
  return useSyncExternalStore(diffComposers.subscribe, () => diffComposers.get(sessionId, path));
}

export function useChatFocusRequest(sessionId: string) {
  return useSyncExternalStore(diffComposers.subscribe, () => diffComposers.focusKey(sessionId));
}
