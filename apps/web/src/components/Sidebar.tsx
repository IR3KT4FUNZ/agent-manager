import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { SessionInfo } from "@agent-manager/shared";
import {
  closeProject,
  createSession,
  deleteSession,
  listProjects,
  listSessions,
  openProject,
} from "../lib/api";
import { isTauri } from "../lib/platform";

export function Sidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [directory, setDirectory] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    refetchInterval: 5_000,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
    refetchInterval: 5_000,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
  }

  function openSession(session: SessionInfo) {
    refresh();
    navigate({ to: "/sessions/$sessionId", params: { sessionId: session.id } });
  }

  const open = useMutation({
    mutationFn: async (path?: string) => {
      const project = await openProject(path);
      return createSession({ projectId: project.id });
    },
    onSuccess: (session) => {
      setPickingDirectory(false);
      setDirectory("");
      openSession(session);
    },
  });

  const addSession = useMutation({
    mutationFn: (projectId: string) => createSession({ projectId }),
    onSuccess: openSession,
  });

  const close = useMutation({
    mutationFn: closeProject,
    onSuccess: () => {
      refresh();
      navigate({ to: "/" });
    },
  });

  const remove = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      refresh();
      navigate({ to: "/" });
    },
  });

  const error = (open.error ?? addSession.error ?? close.error ?? remove.error) as Error | null;

  async function startOpenProject() {
    if (isTauri) {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true, title: "Choose a project folder" });
      if (typeof selected === "string") open.mutate(selected);
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
              open.mutate(directory.trim() || undefined);
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
                disabled={open.isPending}
                className="flex-1 rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
              >
                {open.isPending ? "Opening…" : "Open"}
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
            onClick={startOpenProject}
            disabled={open.isPending}
            className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
          >
            {open.isPending ? "Opening…" : "New project"}
          </button>
        )}
        {error && <p className="text-xs text-red-400">{error.message}</p>}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-3">
        {projects.map((project) => {
          const projectSessions = sessions.filter((session) => session.projectId === project.id);
          return (
            <div key={project.id} className="space-y-1">
              <div className="group flex items-center gap-1 px-2">
                <span
                  className="truncate text-xs font-semibold tracking-wide text-zinc-500 uppercase"
                  title={project.path}
                >
                  {project.name}
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => addSession.mutate(project.id)}
                  disabled={addSession.isPending}
                  className="shrink-0 rounded px-1 text-xs leading-none text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-zinc-100 disabled:text-zinc-700"
                  title="New session in this project"
                >
                  +
                </button>
                <button
                  onClick={() => close.mutate(project.id)}
                  className="shrink-0 rounded px-1 text-xs leading-none text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-400"
                  title="Close project and kill its sessions"
                >
                  ×
                </button>
              </div>

              {projectSessions.length === 0 ? (
                <p className="px-2 py-1 text-xs text-zinc-600">No sessions yet</p>
              ) : (
                projectSessions.map((session) => (
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
                    <span className="min-w-0 flex-1 truncate">
                      {session.worktree ? `⑂ ${session.title}` : session.title}
                    </span>
                    <button
                      onClick={(event) => {
                        event.preventDefault();
                        remove.mutate(session.id);
                      }}
                      className="shrink-0 rounded px-1 leading-none text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-400"
                      title="Kill session"
                    >
                      ×
                    </button>
                  </Link>
                ))
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
