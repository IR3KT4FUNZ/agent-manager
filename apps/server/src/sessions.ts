import { spawn } from "bun-pty";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { CreateSessionRequest, ServerMessage, SessionInfo } from "@agent-manager/shared";

const SCROLLBACK_LIMIT = 400_000;

type Subscriber = (message: ServerMessage) => void;

function resolveCwd(cwd?: string): string {
  if (!cwd) return homedir();
  const expanded =
    cwd === "~" ? homedir() : cwd.startsWith("~/") ? join(homedir(), cwd.slice(2)) : cwd;
  if (!existsSync(expanded) || !statSync(expanded).isDirectory()) {
    throw new Error(`Not a directory: ${expanded}`);
  }
  return expanded;
}

export class Session {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();
  readonly command: string;
  readonly cwd: string;
  readonly title: string;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;

  private scrollback = "";
  private subscribers = new Set<Subscriber>();
  private pty: ReturnType<typeof spawn>;

  constructor(request: CreateSessionRequest) {
    this.command = request.command ?? "claude";
    this.cwd = resolveCwd(request.cwd);
    this.title = request.title ?? `${basename(this.command)} · ${basename(this.cwd)}`;

    this.pty = spawn(this.command, request.args ?? [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: this.cwd,
      env: process.env as Record<string, string>,
    });

    this.pty.onData((data: string) => {
      this.scrollback = (this.scrollback + data).slice(-SCROLLBACK_LIMIT);
      this.broadcast({ type: "output", data });
    });

    this.pty.onExit(({ exitCode }: { exitCode: number }) => {
      this.status = "exited";
      this.exitCode = exitCode;
      this.broadcast({ type: "exit", exitCode });
    });
  }

  info(): SessionInfo {
    return {
      id: this.id,
      title: this.title,
      command: this.command,
      cwd: this.cwd,
      status: this.status,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
    };
  }

  attach(subscriber: Subscriber): () => void {
    subscriber({ type: "info", session: this.info() });
    if (this.scrollback) subscriber({ type: "output", data: this.scrollback });
    if (this.status === "exited") subscriber({ type: "exit", exitCode: this.exitCode ?? 0 });
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  write(data: string) {
    if (this.status === "running") this.pty.write(data);
  }

  resize(cols: number, rows: number) {
    if (this.status === "running" && cols > 0 && rows > 0) this.pty.resize(cols, rows);
  }

  dispose() {
    if (this.status === "running") this.pty.kill();
  }

  private broadcast(message: ServerMessage) {
    for (const subscriber of this.subscribers) subscriber(message);
  }
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  create(request: CreateSessionRequest): Session {
    const session = new Session(request);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info());
  }

  dispose(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.dispose();
    this.sessions.delete(id);
    return true;
  }
}
