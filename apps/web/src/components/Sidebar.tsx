import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { createSession, deleteSession, listSessions } from "../lib/api";

export function Sidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
    refetchInterval: 5_000,
  });

  const create = useMutation({
    mutationFn: () => createSession({}),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
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

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900">
      <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold tracking-wide">
        Agent Manager
      </div>

      <div className="p-3">
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending}
          className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
        >
          {create.isPending ? "Starting…" : "New Claude session"}
        </button>
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
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
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
