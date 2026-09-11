import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { AgentSelection, SessionInfo } from "@agent-manager/shared";
import {
  closeProject,
  createSession,
  deleteSession,
  getGithubStatus,
  getCodexCatalog,
  listProjects,
  listSessions,
  openProject,
} from "../lib/api";
import { isTauri } from "../lib/platform";
import { OpenPrPicker } from "./OpenPrPicker";
import { AgentControls } from "./AgentControls";
import { launchSelection, reconcileAgentPreferences, useAgentPreferences } from "../lib/agentPreferences";

export function Sidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [directory, setDirectory] = useState("");
  const [prPickerFor, setPrPickerFor] = useState<string | null>(null);
  const { preferences, setPreferences } = useAgentPreferences();
  const [agentNotice, setAgentNotice] = useState("");
  const catalog = useQuery({
    queryKey: ["codex-catalog"],
    queryFn: () => getCodexCatalog(),
    enabled: preferences.agent === "codex",
    staleTime: 5 * 60_000,
    retry: false,
  });
  const refreshCatalog = useMutation({
    mutationFn: () => getCodexCatalog(true),
    onSuccess: (data) => queryClient.setQueryData(["codex-catalog"], data),
  });
  useEffect(() => {
    if (!catalog.data?.installed || catalog.data.error) return;
    const next = reconcileAgentPreferences(preferences, catalog.data.models);
    if (next !== preferences) {
      setAgentNotice(next.model
        ? "The saved reasoning effort is unavailable. Using this model's recommended effort."
        : "The saved model is unavailable. Using Codex settings.");
      setPreferences(next);
    }
  }, [catalog.data, preferences, setPreferences]);
  const canLaunch = preferences.agent === "claude" || (
    catalog.data?.installed === true && (!preferences.model || (
      !catalog.data.error && catalog.data.models.some((model) => model.model === preferences.model)
    ))
  );
  const selection = () => launchSelection(preferences);

  const { data: github } = useQuery({
    queryKey: ["github-status"],
    queryFn: getGithubStatus,
    staleTime: Infinity,
  });
  const githubReady = !github || (github.installed && github.authenticated);

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
    mutationFn: async ({ path, agent }: { path?: string; agent: AgentSelection }) => {
      const project = await openProject(path);
      return createSession({ projectId: project.id, ...agent });
    },
    onSuccess: (session) => {
      setPickingDirectory(false);
      setDirectory("");
      openSession(session);
    },
  });

  const addSession = useMutation({
    mutationFn: (request: { projectId: string } & AgentSelection) => createSession(request),
    onSuccess: openSession,
  });

  const openPr = useMutation({
    mutationFn: (request: { projectId: string; prNumber: string | number } & AgentSelection) =>
      createSession(request),
    onSuccess: (session) => {
      setPrPickerFor(null);
      openSession(session);
    },
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

  const error = (open.error ??
    addSession.error ??
    openPr.error ??
    close.error ??
    remove.error) as Error | null;

  async function startOpenProject() {
    if (isTauri) {
      const agent = selection();
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const selected = await openDialog({ directory: true, title: "Choose a project folder" });
      if (typeof selected === "string") open.mutate({ path: selected, agent });
    } else {
      setPickingDirectory(true);
    }
  }

  return (
    <aside className="flex h-full flex-col bg-zinc-900">
      <div className="space-y-2 p-3">
        <AgentControls
          preferences={preferences}
          onChange={(next) => { setAgentNotice(""); setPreferences(next); }}
          catalog={catalog.data}
          loading={catalog.isFetching || refreshCatalog.isPending}
          error={(refreshCatalog.error ?? catalog.error)?.message}
          notice={agentNotice}
          onRetry={() => refreshCatalog.mutate()}
        />
        {pickingDirectory ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canLaunch) open.mutate({ path: directory.trim() || undefined, agent: selection() });
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
                disabled={open.isPending || !canLaunch}
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
            disabled={open.isPending || !canLaunch}
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
                  className="min-w-0 wrap-anywhere text-xs font-semibold tracking-wide text-zinc-500 uppercase"
                  title={project.path}
                >
                  {project.name}
                </span>
                <span className="flex-1" />
                {project.isRepo && (
                  <button
                    onClick={() =>
                      setPrPickerFor((current) => (current === project.id ? null : project.id))
                    }
                    disabled={!githubReady || openPr.isPending || !canLaunch}
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none font-semibold transition-colors disabled:border-zinc-800 disabled:text-zinc-700 ${
                      prPickerFor === project.id
                        ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                        : "border-zinc-700 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                    }`}
                    title={
                      githubReady
                        ? "Review a GitHub pull request in this project"
                        : (github?.message ?? "GitHub CLI unavailable")
                    }
                  >
                    PR
                  </button>
                )}
                <button
                  onClick={() => addSession.mutate({ projectId: project.id, ...selection() })}
                  disabled={addSession.isPending || !canLaunch}
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

              {prPickerFor === project.id && (
                <OpenPrPicker
                  projectId={project.id}
                  pending={openPr.isPending || !canLaunch}
                  onOpen={(prNumber) => { if (canLaunch) openPr.mutate({ projectId: project.id, prNumber, ...selection() }); }}
                  onCancel={() => setPrPickerFor(null)}
                />
              )}

              {openPr.isPending && openPr.variables?.projectId === project.id && (
                <p className="px-2 py-1 text-xs text-zinc-500">Checking out the pull request…</p>
              )}

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
                    <span className="min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere">
                      {session.worktree ? `⑂ ${session.title}` : session.title}
                    </span>
                    {session.agent && (
                      <span
                        className="shrink-0 rounded border border-zinc-700 px-1 py-0.5 text-[9px] text-zinc-500"
                        title={`Launch settings: ${session.agent}${session.model ? ` · ${session.model} · ${session.reasoningEffort}` : " · CLI defaults"}`}
                      >
                        {session.agent === "codex" ? "Codex" : "Claude"}
                      </span>
                    )}
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
