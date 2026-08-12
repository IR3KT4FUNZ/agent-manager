import type { DiffHunk, DiffLine } from "@agent-manager/shared";

export interface ParsedDiff {
  isBinary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function count(value: string | undefined): number {
  return value === undefined ? 1 : Number(value);
}

// Parses `git diff` output for a single file. Paths in the `diff --git` /
// `---` / `+++` headers are deliberately ignored: the caller already knows
// which file it asked for, and those paths are quoted and prefixed by git.
export function parseUnifiedDiff(raw: string): ParsedDiff {
  const hunks: DiffHunk[] = [];
  let isBinary = false;
  let additions = 0;
  let deletions = 0;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      hunk = null;
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    if (header) {
      hunk = {
        oldStart: Number(header[1]),
        oldLines: count(header[2]),
        newStart: Number(header[3]),
        newLines: count(header[4]),
        header: header[5] ?? "",
        lines: [],
      };
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      hunks.push(hunk);
      continue;
    }

    if (!hunk) {
      if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) isBinary = true;
      continue;
    }

    if (line.startsWith("\\")) {
      const previous = hunk.lines[hunk.lines.length - 1];
      if (previous) previous.noNewline = true;
      continue;
    }

    const text = line.slice(1);
    let entry: DiffLine | null = null;
    if (line.startsWith("+")) {
      entry = { kind: "add", text, oldLine: null, newLine: newLine++ };
      additions++;
    } else if (line.startsWith("-")) {
      entry = { kind: "del", text, oldLine: oldLine++, newLine: null };
      deletions++;
    } else if (line.startsWith(" ")) {
      entry = { kind: "context", text, oldLine: oldLine++, newLine: newLine++ };
    }
    if (entry) hunk.lines.push(entry);
  }

  return { isBinary, hunks, additions, deletions };
}
