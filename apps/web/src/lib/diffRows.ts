import type { DiffHunk, DiffLine } from "@agent-manager/shared";

export interface DiffRow {
  old: DiffLine | null;
  new: DiffLine | null;
}

// Lays a hunk out side by side: context spans both sides, and a run of removals
// is paired with the run of additions that follows it, one row per pair.
export function buildSideBySideRows(hunk: DiffHunk): DiffRow[] {
  const rows: DiffRow[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];

  function flushPairs() {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      rows.push({ old: removed[i] ?? null, new: added[i] ?? null });
    }
    removed = [];
    added = [];
  }

  for (const line of hunk.lines) {
    if (line.kind === "del") removed.push(line);
    else if (line.kind === "add") added.push(line);
    else {
      flushPairs();
      rows.push({ old: line, new: line });
    }
  }
  flushPairs();

  return rows;
}
