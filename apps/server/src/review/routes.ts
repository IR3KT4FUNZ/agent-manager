import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Session, SessionManager } from "../sessions";
import { MAX_QUESTION_BYTES, QuestionError, validateQuestion } from "../questions";
import { SourceError } from "../source";

export function reviewRoutes(manager: Pick<SessionManager, "get">) {
  const app = new Hono<{ Variables: { session: Session } }>();
  app.use("/:id/*", bodyLimit({ maxSize: MAX_QUESTION_BYTES, onError: c => c.json({ error: "Review request exceeds 64 KiB." }, 413) }));
  app.use("/:id/*", async (c, next) => {
    const session = manager.get(c.req.param("id")!);
    if (!session) return c.json({ error: "session not found" }, 404);
    c.set("session", session);
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message }, error instanceof QuestionError || error instanceof SourceError ? error.status : 400));
  app.get("/:id/review", c => c.json(c.get("session").review.state()));
  app.post("/:id/review/agent", async c => {
    c.get("session").review.configure(await c.req.json());
    return c.json(c.get("session").review.state());
  });
  app.post("/:id/review/messages", async c => c.json(c.get("session").review.submit(await c.req.json()), 202));
  app.post("/:id/review/jobs/:jobId/cancel", c => {
    c.get("session").review.cancel(c.req.param("jobId"));
    return c.json({ ok: true });
  });
  app.post("/:id/questions", async c => {
    const request = validateQuestion(await c.req.json());
    return c.json(c.get("session").review.submit(request));
  });
  return app;
}
