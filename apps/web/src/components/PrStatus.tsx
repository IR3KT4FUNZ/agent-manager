import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrState } from "@agent-manager/shared";
import { getSessionPr, syncSessionPr } from "../lib/api";

const STATE_STYLE: Record<PrState, string> = {
  OPEN: "text-emerald-400",
  MERGED: "text-violet-400",
  CLOSED: "text-rose-400",
};

function stateLabel(state: PrState): string {
  return state.charAt(0) + state.slice(1).toLowerCase();
}

export function useSessionPr(sessionId: string) {
  return useQuery({
    queryKey: ["session-pr", sessionId],
    queryFn: () => getSessionPr(sessionId),
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
}

export function PrBadge({ sessionId }: { sessionId: string }) {
  const { data } = useSessionPr(sessionId);
  const pr = data?.pr;
  if (!pr) return null;

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      onPointerDown={(event) => event.stopPropagation()}
      title={`${pr.baseRepo}#${pr.number} — ${pr.title}`}
      className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 hover:bg-zinc-700"
    >
      #{pr.number}{" "}
      <span className={STATE_STYLE[pr.state]}>
        · {pr.isDraft ? "Draft" : stateLabel(pr.state)}
      </span>
    </a>
  );
}

export function PrDesyncBanner({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const { data } = useSessionPr(sessionId);

  const sync = useMutation({
    mutationFn: () => syncSessionPr(sessionId),
    onSuccess: () => {
      for (const key of ["session-pr", "changes", "diff"]) {
        queryClient.invalidateQueries({ queryKey: [key, sessionId] });
      }
    },
  });

  if (!data?.pr || !data.remoteAdvanced) return null;
  const blocked = data.localDirty || data.localAhead;

  return (
    <div className="shrink-0 space-y-1.5 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
      <p>
        #{data.pr.number} has moved on GitHub. Comments anchor to the PR head there, not to your
        edits.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => sync.mutate()}
          disabled={blocked || sync.isPending}
          title={
            blocked
              ? "Commit or discard the worktree's local changes first"
              : "Reset the worktree to the current PR head"
          }
          className="rounded-md bg-amber-500/20 px-2 py-1 font-medium text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {sync.isPending ? "Updating…" : "Update to PR head"}
        </button>
        {blocked && <span className="text-amber-200/70">Local changes are in the way.</span>}
      </div>
      {sync.error && <p className="text-rose-300">{(sync.error as Error).message}</p>}
    </div>
  );
}
