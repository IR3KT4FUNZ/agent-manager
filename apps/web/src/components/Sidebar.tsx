import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { createSession, deleteSession, listSessions } from "../lib/api";
import { isTauri } from "../lib/platform";

export function Sidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [directory, setDirectory] = useState("");

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
    refetchInterval: 5_000,
  });

  const create = useMutation({
    mutationFn: (cwd?: string) => createSession(cwd ? { cwd } : {}),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setPickingDirectory(false);
      setDirectory("");
      navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
    },
  });

  const remove = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate({ to: "/" });
    },
  });

  async function startNewSession() {
    if (isTauri) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "Choose a project folder" });
      if (typeof selected === "string") create.mutate(selected);
    } else {
      setPickingDirectory(true);
    }
  }

  return (
    <aside className="flex h-full flex-col bg-zinc-900">
      <div className="space-y-2 p-3">
        {pickingDirectory ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(directory.trim() || undefined);
            }}
            className="space-y-2"
          >
            <input
              autoFocus
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder="~/path/to/project"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={create.isPending}
                className="flex-1 rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
              >
                {create.isPending ? "Starting…" : "Start"}
              </button>
              <button
                type="button"
                onClick={() => setPickingDirectory(false)}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={startNewSession}
            disabled={create.isPending}
            className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
          >
            {create.isPending ? "Starting…" : "New Claude session"}
          </button>
        )}
        {create.isError && (
          <p className="text-xs text-red-400">{(create.error as Error).message}</p>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {sessions.map((session) => (
          <Link
            key={session.id}
            to="/sessions/$sessionId"
            params={{ sessionId: session.id }}
            className="group flex items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            activeProps={{ className: "bg-zinc-800 text-zinc-100" }}
          >
            <span
              className={`size-2 shrink-0 rounded-full ${
                session.status === "running" ? "bg-emerald-500" : "bg-zinc-600"
              }`}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{session.title}</span>
              {session.worktree && (
                <span className="truncate text-xs text-zinc-500">
                  ⑂ {session.worktree.branch}
                </span>
              )}
            </span>
            <button
              onClick={(event) => {
                event.preventDefault();
                remove.mutate(session.id);
              }}
              className="hidden shrink-0 rounded px-1 text-zinc-500 hover:text-red-400 group-hover:block"
              title="Kill session"
            >
              ×
            </button>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
