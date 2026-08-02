import { Hono } from "hono";
import type { Context } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import type { WSEvents } from "hono/ws";
import type { ServerWebSocket } from "bun";
import type {
  ClientMessage,
  CreateSessionRequest,
  OpenDiffRequest,
  OpenProjectRequest,
  ServerMessage,
} from "@agent-manager/shared";
import { ProjectManager } from "./projects";
import { SessionManager } from "./sessions";
import { listChanges, openDiffInZed } from "./changes";

const projects = new ProjectManager();
const manager = new SessionManager();
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/projects", (c) => c.json(projects.list()));

app.post("/api/projects", async (c) => {
  const { path } = (await c.req.json().catch(() => ({}))) as OpenProjectRequest;
  try {
    const project = await projects.open(path);
    return c.json(project.info(), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.delete("/api/projects/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!projects.get(id)) return c.json({ error: "project not found" }, 404);
  await manager.disposeProject(id);
  projects.close(id);
  return c.json({ ok: true });
});

app.get("/api/sessions", (c) => c.json(manager.list()));

app.post("/api/sessions", async (c) => {
  const request = (await c.req.json().catch(() => ({}))) as CreateSessionRequest;
  const project = projects.get(request.projectId ?? "");
  if (!project) return c.json({ error: "project not found" }, 404);
  try {
    const session = await manager.create(project, request);
    return c.json(session.info(), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.delete("/api/sessions/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!(await manager.dispose(id))) return c.json({ error: "session not found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/sessions/:id/changes", async (c) => {
  const session = manager.get(c.req.param("id") ?? "");
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.worktree) return c.json({ base: "", files: [] });
  try {
    return c.json(await listChanges(session.worktree));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.post("/api/sessions/:id/open-diff", async (c) => {
  const session = manager.get(c.req.param("id") ?? "");
  if (!session) return c.json({ error: "session not found" }, 404);
  if (!session.worktree) return c.json({ error: "session has no git worktree" }, 400);
  const { path } = (await c.req.json().catch(() => ({}))) as OpenDiffRequest;
  if (!path) return c.json({ error: "missing path" }, 400);
  try {
    await openDiffInZed(session.worktree, path);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

interface Attachable {
  attach(subscriber: (message: ServerMessage) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

function ptySocket(resolve: (c: Context) => Attachable | undefined) {
  return (c: Context): WSEvents<ServerWebSocket> => {
    const target = resolve(c);
    let unsubscribe: (() => void) | undefined;
    return {
      onOpen(_event, ws) {
        if (!target) {
          ws.close(4404, "session not found");
          return;
        }
        unsubscribe = target.attach((message) => ws.send(JSON.stringify(message)));
      },
      onMessage(event) {
        if (!target) return;
        let message: ClientMessage;
        try {
          message = JSON.parse(String(event.data)) as ClientMessage;
        } catch {
          return;
        }
        if (message.type === "input") target.write(message.data);
        else if (message.type === "resize") target.resize(message.cols, message.rows);
      },
      onClose() {
        unsubscribe?.();
      },
    };
  };
}

app.get(
  "/ws/sessions/:id",
  upgradeWebSocket(ptySocket((c) => manager.get(c.req.param("id") ?? ""))),
);

app.get(
  "/ws/sessions/:id/terminal",
  upgradeWebSocket(ptySocket((c) => manager.get(c.req.param("id") ?? "")?.terminal())),
);

// In production the built web app is served by this same process.
app.use("*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

const port = Number(process.env.PORT ?? 3001);

Bun.serve({
  port,
  fetch: app.fetch,
  websocket,
});

console.log(`agent-manager server listening on http://localhost:${port}`);
