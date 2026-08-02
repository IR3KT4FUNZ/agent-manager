import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { APP_NAME } from "@agent-manager/shared";
import { Sidebar } from "./components/Sidebar";
import { SessionShellTerminal, SessionTerminal } from "./components/SessionTerminal";
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
        { id: "sessions", title: "Sessions", defaultWidth: 256, content: <Sidebar /> },
        {
          id: "chat",
          title: "Chat",
          defaultWidth: 640,
          content: (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Open a project or select a session to get started
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
        { id: "sessions", title: "Sessions", defaultWidth: 256, content: <Sidebar /> },
        {
          id: "changes",
          title: "Changes",
          headerRight: <ChangedFilesBase sessionId={sessionId} />,
          defaultWidth: 288,
          content: (
            <div className="flex h-full min-h-0 flex-col">
              <ChangedFiles
                key={`changes-${sessionId}`}
                sessionId={sessionId}
                className="min-h-0 flex-1 basis-0"
              />
              <div className="min-h-0 flex-1 basis-0 border-t border-zinc-800">
                <SessionShellTerminal key={`shell-${sessionId}`} sessionId={sessionId} />
              </div>
            </div>
          ),
        },
        {
          id: "chat",
          title: "Chat",
          defaultWidth: 640,
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
