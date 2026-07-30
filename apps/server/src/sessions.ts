import { spawn } from "bun-pty";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  CreateSessionRequest,
  ServerMessage,
  SessionInfo,
  WorktreeInfo,
} from "@agent-manager/shared";
import type { Project } from "./projects";
import { createWorktree, discardWorktree, removeWorktree } from "./worktrees";

const SCROLLBACK_LIMIT = 400_000;

type Subscriber = (message: ServerMessage) => void;

interface ResolvedSession {
  projectId: string;
  command: string;
  args: string[];
  cwd: string;
  title: string;
  worktree?: WorktreeInfo;
}

async function resolveSession(
  project: Project,
  request: CreateSessionRequest,
): Promise<ResolvedSession> {
  const command = request.command ?? "claude";
  const args = request.args ?? [];

  let cwd = project.root;
  let worktree: WorktreeInfo | undefined;
  if (project.repoRoot) {
    worktree = await createWorktree(project.repoRoot);
    cwd = worktree.path;
  }

  const title = request.title ?? worktree?.branch ?? `${basename(command)} · ${basename(cwd)}`;
  return { projectId: project.id, command, args, cwd, title, worktree };
}

export class Session {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();
  readonly projectId: string;
  readonly command: string;
  readonly cwd: string;
  readonly title: string;
  readonly worktree?: WorktreeInfo;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;

  private scrollback = "";
  private subscribers = new Set<Subscriber>();
  private pty: ReturnType<typeof spawn>;

  constructor(resolved: ResolvedSession) {
    this.projectId = resolved.projectId;
    this.command = resolved.command;
    this.cwd = resolved.cwd;
    this.title = resolved.title;
    this.worktree = resolved.worktree;

    this.pty = spawn(this.command, resolved.args, {
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
      projectId: this.projectId,
      title: this.title,
      command: this.command,
      cwd: this.cwd,
      status: this.status,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      worktree: this.worktree,
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

  async create(project: Project, request: CreateSessionRequest): Promise<Session> {
    const resolved = await resolveSession(project, request);
    let session: Session;
    try {
      session = new Session(resolved);
    } catch (error) {
      if (resolved.worktree) await discardWorktree(resolved.worktree).catch(() => {});
      throw error;
    }
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info());
  }

  async disposeProject(projectId: string): Promise<void> {
    const ids = [...this.sessions.values()]
      .filter((session) => session.projectId === projectId)
      .map((session) => session.id);
    for (const id of ids) await this.dispose(id);
  }

  async dispose(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.dispose();
    this.sessions.delete(id);
    if (session.worktree) {
      await removeWorktree(session.worktree).catch((error) => {
        console.warn(`failed to remove worktree for session ${id}:`, error);
      });
    }
    return true;
  }
}
