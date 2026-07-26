import { Hono } from "hono";
import { serveStatic } from "hono/bun";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

// In production the built web app is served by this same process.
app.use("*", serveStatic({ root: "../web/dist" }));
app.get("*", serveStatic({ path: "../web/dist/index.html" }));

const port = Number(process.env.PORT ?? 3001);

Bun.serve({ port, fetch: app.fetch });

console.log(`agent-manager server listening on http://localhost:${port}`);
