import { useSyncExternalStore } from "react";
import type { SourceLocation } from "@agent-manager/shared";

export interface CodeView {
  mode: "diff" | "source";
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  version?: string;
  side?: "old" | "new";
  scrollTop?: number;
  scrollLeft?: number;
}

export class CodeHistory {
  private state: { entries: CodeView[]; index: number; open: boolean } = {
    entries: [],
    index: -1,
    open: false,
  };
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  private emit() {
    for (const listener of this.listeners) listener();
  }

  visit(view: CodeView) {
    this.state = {
      entries: [...this.state.entries.slice(0, this.state.index + 1), { ...view }],
      index: this.state.index + 1,
      open: true,
    };
    this.emit();
  }

  move(delta: number) {
    const index = this.state.index + delta;
    if (index < 0 || index >= this.state.entries.length) return;
    this.state = { ...this.state, index, open: true };
    this.emit();
  }

  save(view: Partial<CodeView>) {
    const current = this.state.entries[this.state.index];
    if (current) Object.assign(current, view);
  }

  close() {
    this.state = { ...this.state, open: false };
    this.emit();
  }
}

const histories = new Map<string, CodeHistory>();

export function useCodeHistory(sessionId: string) {
  let history = histories.get(sessionId);
  if (!history) {
    history = new CodeHistory();
    histories.set(sessionId, history);
  }
  const state = useSyncExternalStore(history.subscribe, history.snapshot);
  return {
    history,
    ...state,
    current: state.open ? state.entries[state.index] : undefined,
  };
}

export function groupLocations(locations: SourceLocation[]): Map<string, SourceLocation[]> {
  const groups = new Map<string, SourceLocation[]>();
  for (const location of locations) {
    const group = groups.get(location.path) ?? [];
    group.push(location);
    groups.set(location.path, group);
  }
  return groups;
}

export function supportsNavigation(path: string): boolean {
  return /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(path);
}
