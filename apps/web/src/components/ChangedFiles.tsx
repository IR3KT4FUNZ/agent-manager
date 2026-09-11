import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChangeEntry, ChangeStatus } from "@agent-manager/shared";
import { getSessionChanges } from "../lib/api";

const STATUS: Record<ChangeStatus, { glyph: string; className: string; label: string }> = {
  added: { glyph: "A", className: "text-emerald-400", label: "Added" },
  modified: { glyph: "M", className: "text-amber-400", label: "Modified" },
  deleted: { glyph: "D", className: "text-rose-400", label: "Deleted" },
  renamed: { glyph: "R", className: "text-sky-400", label: "Renamed" },
  untracked: { glyph: "U", className: "text-zinc-500", label: "Untracked" },
};

function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf("/");
  return idx === -1
    ? { dir: "", name: path }
    : { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

function useSessionChanges(sessionId: string) {
  return useQuery({
    queryKey: ["changes", sessionId],
    queryFn: () => getSessionChanges(sessionId),
    refetchInterval: 3_000,
  });
}

export function ChangedFilesBase({ sessionId }: { sessionId: string }) {
  const { data } = useSessionChanges(sessionId);
  if (!data?.base) return null;
  return (
    <span className="truncate font-mono text-[10px] text-zinc-500" title={`vs ${data.base}`}>
      vs {data.base}
    </span>
  );
}

function FileLabel({ file }: { file: ChangeEntry }) {
  const { dir, name } = splitPath(file.path);
  return (
    <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">
      {file.oldPath && <span className="text-zinc-500">{splitPath(file.oldPath).name} → </span>}
      {dir && <span className="text-zinc-500">{dir}</span>}
      <span>{name}</span>
    </span>
  );
}

export function ChangedFiles({
  sessionId,
  selectedPath,
  onSelect,
  autoSelectFirst,
  className,
}: {
  sessionId: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  autoSelectFirst?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useSessionChanges(sessionId);

  const files = data?.files ?? [];
  const isGit = data ? data.base !== "" : true;

  // Opening a pull request should land on its diff, not on an empty panel.
  const autoSelected = useRef(false);
  useEffect(() => {
    const first = files[0];
    if (!autoSelectFirst || autoSelected.current || selectedPath || !first) return;
    autoSelected.current = true;
    onSelect(first.path);
  }, [autoSelectFirst, files, onSelect, selectedPath]);

  return (
    <div className={`flex flex-col bg-zinc-900 ${className ?? ""}`}>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!isGit ? (
          <p className="px-3 py-2 text-xs text-zinc-500">Not a git session.</p>
        ) : isLoading ? (
          <p className="px-3 py-2 text-xs text-zinc-500">Loading…</p>
        ) : files.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-500">No changes vs {data?.base}.</p>
        ) : (
          files.map((file) => {
            const meta = STATUS[file.status];
            return (
              <button
                key={file.path}
                onClick={() => onSelect(file.path)}
                title={`${meta.label} — show the diff`}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm text-zinc-300 hover:bg-zinc-800 ${
                  file.path === selectedPath ? "bg-zinc-800" : ""
                }`}
              >
                <span className={`w-3 shrink-0 text-center font-mono text-xs ${meta.className}`}>
                  {meta.glyph}
                </span>
                <FileLabel file={file} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
