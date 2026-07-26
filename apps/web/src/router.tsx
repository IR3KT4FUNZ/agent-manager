import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Sidebar } from "./components/Sidebar";
import { SessionTerminal } from "./components/SessionTerminal";

const rootRoute = createRootRoute({
  component: () => (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <div className="flex h-full items-center justify-center text-sm text-zinc-500">
      Create or select a session to get started
    </div>
  ),
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = sessionRoute.useParams();
  return <SessionTerminal key={sessionId} sessionId={sessionId} />;
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, sessionRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
