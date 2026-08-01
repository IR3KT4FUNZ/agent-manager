import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { APP_NAME } from "@agent-manager/shared";
import { Sidebar } from "./components/Sidebar";
import { SessionTerminal } from "./components/SessionTerminal";
import { ChangedFiles, ChangedFilesBase } from "./components/ChangedFiles";
import { PanelBoard } from "./components/PanelBoard";
import { isTauri } from "./lib/platform";

const rootRoute = createRootRoute({
  component: () => (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      {isTauri && (
        <header
          data-tauri-drag-region
          className="flex h-9 shrink-0 items-center justify-center border-b border-zinc-800 bg-zinc-900"
        >
          <span className="pointer-events-none text-xs font-medium text-zinc-500 select-none">
            {APP_NAME}
          </span>
        </header>
      )}
      <div className="flex min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <PanelBoard
      panels={[
        { id: "sessions", title: "Sessions", className: "w-64 shrink-0", content: <Sidebar /> },
        {
          id: "chat",
          title: "Chat",
          className: "flex-1",
          content: (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Create or select a session to get started
            </div>
          ),
        },
      ]}
    />
  ),
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = sessionRoute.useParams();
  return (
    <PanelBoard
      panels={[
        { id: "sessions", title: "Sessions", className: "w-64 shrink-0", content: <Sidebar /> },
        {
          id: "changes",
          title: "Changes",
          headerRight: <ChangedFilesBase sessionId={sessionId} />,
          className: "w-72 shrink-0",
          content: (
            <ChangedFiles key={`changes-${sessionId}`} sessionId={sessionId} className="h-full" />
          ),
        },
        {
          id: "chat",
          title: "Chat",
          className: "flex-1",
          content: <SessionTerminal key={sessionId} sessionId={sessionId} />,
        },
      ]}
    />
  );
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, sessionRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
