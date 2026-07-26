import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import type { ServerWebSocket } from "bun";
import type { ClientMessage, CreateSessionRequest } from "@agent-manager/shared";
import { SessionManager } from "./sessions";

const manager = new SessionManager();
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/sessions", (c) => c.json(manager.list()));

app.post("/api/sessions", async (c) => {
  const request = (await c.req.json().catch(() => ({}))) as CreateSessionRequest;
  try {
    const session = manager.create(request);
    return c.json(session.info(), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.delete("/api/sessions/:id", (c) => {
  const id = c.req.param("id") ?? "";
  if (!manager.dispose(id)) return c.json({ error: "session not found" }, 404);
  return c.json({ ok: true });
});

app.get(
  "/ws/sessions/:id",
  upgradeWebSocket((c) => {
    const session = manager.get(c.req.param("id") ?? "");
    let unsubscribe: (() => void) | undefined;
    return {
      onOpen(_event, ws) {
        if (!session) {
          ws.close(4404, "session not found");
          return;
        }
        unsubscribe = session.attach((message) => ws.send(JSON.stringify(message)));
      },
      onMessage(event) {
        if (!session) return;
        let message: ClientMessage;
        try {
          message = JSON.parse(String(event.data)) as ClientMessage;
        } catch {
          return;
        }
        if (message.type === "input") session.write(message.data);
        else if (message.type === "resize") session.resize(message.cols, message.rows);
      },
      onClose() {
        unsubscribe?.();
      },
    };
  }),
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
