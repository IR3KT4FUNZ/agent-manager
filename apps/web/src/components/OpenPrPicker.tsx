import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProjectPulls } from "../lib/api";

export function OpenPrPicker({
  projectId,
  pending,
  onOpen,
  onCancel,
}: {
  projectId: string;
  pending: boolean;
  onOpen: (reference: string | number) => void;
  onCancel: () => void;
}) {
  const [reference, setReference] = useState("");

  const {
    data: pulls = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["pulls", projectId],
    queryFn: () => listProjectPulls(projectId),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-2 px-2 pb-1">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = reference.trim();
          if (trimmed) onOpen(trimmed);
        }}
        className="flex gap-1"
      >
        <input
          autoFocus
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="#123 or PR URL"
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Cancel
        </button>
      </form>

      <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-800">
        {isLoading ? (
          <p className="px-2 py-1.5 text-xs text-zinc-500">Loading pull requests…</p>
        ) : error ? (
          <p className="px-2 py-1.5 text-xs text-rose-400">{(error as Error).message}</p>
        ) : pulls.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-zinc-500">No open pull requests.</p>
        ) : (
          pulls.map((pull) => (
            <button
              key={pull.number}
              onClick={() => onOpen(pull.number)}
              disabled={pending}
              title={`${pull.title} — ${pull.author}`}
              className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-zinc-800 disabled:opacity-50"
            >
              <span className="flex w-full min-w-0 items-baseline gap-1.5">
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  #{pull.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{pull.title}</span>
                {pull.isDraft && (
                  <span className="shrink-0 text-[10px] text-zinc-500 uppercase">draft</span>
                )}
              </span>
              <span className="w-full truncate text-[10px] text-zinc-500">
                {pull.author} · {pull.headRefName}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
