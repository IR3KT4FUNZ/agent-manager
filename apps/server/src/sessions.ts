import { ReviewAssistant, type ReviewDependencies } from "./review/assistant";
import { WalkthroughService } from "./walkthrough/service";
import { CodeNavigation } from "./navigation";
import { spawn } from "bun-pty";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  CreateSessionRequest,
  BranchReview,
  PrAssociation,
  PrReviewThread,
  PrStatus,
  ServerMessage,
  SubmitReviewRequest,
  SessionInfo,
  WorktreeInfo,
} from "@agent-manager/shared";
import type { Project } from "./projects";
import { resolveAgentLaunch, type AgentLaunch } from "./agents";
import { resolveBranchReview } from "./branches";
import {
  checkoutPrWorktree,
  loadPrStatus,
  resolvePrAssociation,
  syncWorktreeToPrHead,
  type PrLookup,
} from "./pr";
import { listPrThreads, replyToPrComment, submitPrReview } from "./prComments";
import { trimScrollback } from "./scrollback";
import { ShellTerminal } from "./terminal";
import { createWorktree, discardWorktree, removeWorktree } from "./worktrees";

type Subscriber = (message: ServerMessage) => void;

interface ResolvedSession extends AgentLaunch {
  projectId: string;
  cwd: string;
  title: string;
  worktree?: WorktreeInfo;
  pr?: PrAssociation;
  branchReview?: BranchReview;
}

async function resolveSession(
  project: Project,
  request: CreateSessionRequest,
  resolveLaunch: typeof resolveAgentLaunch,
): Promise<ResolvedSession> {
  const launch = await resolveLaunch(request, project.root);
  const { command } = launch;
  const base = { projectId: project.id, ...launch };

  if (request.branchReview !== undefined) {
    if (request.prNumber !== undefined && String(request.prNumber).trim() !== "") {
      throw new Error("Choose either a pull request or a branch diff to review.");
    }
    if (!project.repoRoot) throw new Error("Branch diffs can only be reviewed in a git repository.");
    const branchReview = await resolveBranchReview(project.repoRoot, request.branchReview);
    const worktree = await createWorktree(project.repoRoot, branchReview.headSha);
    return {
      ...base,
      cwd: worktree.path,
      title: request.title ?? `${branchReview.headRef} vs ${branchReview.baseRef}`,
      worktree,
      branchReview,
    };
  }

  if (request.prNumber !== undefined && String(request.prNumber).trim() !== "") {
    if (!project.repoRoot) {
      throw new Error("Pull requests can only be reviewed in a git repository.");
    }
    const pr = await resolvePrAssociation(project.repoRoot, String(request.prNumber));
    const worktree = await checkoutPrWorktree(project.repoRoot, pr);
    return {
      ...base,
      cwd: worktree.path,
      title: request.title ?? `#${pr.number} ${pr.title}`,
      worktree,
      pr,
    };
  }

  let cwd = project.root;
  let worktree: WorktreeInfo | undefined;
  if (project.repoRoot) {
    worktree = await createWorktree(project.repoRoot);
    cwd = worktree.path;
  }

  const title = request.title ?? worktree?.branch ?? `${basename(command)} · ${basename(cwd)}`;
  return { ...base, cwd, title, worktree };
}

export class Session {
  readonly id = randomUUID();
  readonly createdAt = new Date().toISOString();
  readonly projectId: string;
  readonly command: string;
  readonly agent: AgentLaunch["agent"];
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly cwd: string;
  readonly title: string;
  readonly worktree?: WorktreeInfo;
  pr?: PrAssociation;
  readonly branchReview?: BranchReview;
  status: "running" | "exited" = "running";
  exitCode: number | null = null;

  private prLookup?: PrLookup;
  private scrollback = "";
  private subscribers = new Set<Subscriber>();
  private pty: ReturnType<typeof spawn>;
  private shell?: ShellTerminal;
  readonly navigation: CodeNavigation;
  readonly review: ReviewAssistant;
  readonly walkthrough: WalkthroughService;
  private disposed = false;

  constructor(resolved: ResolvedSession, reviewDependencies: ReviewDependencies = {}) {
    this.projectId = resolved.projectId;
    this.command = resolved.command;
    this.agent = resolved.agent;
    this.model = resolved.model;
    this.reasoningEffort = resolved.reasoningEffort;
    this.cwd = resolved.cwd;
    this.navigation = new CodeNavigation(this.cwd);
    this.title = resolved.title;
    this.worktree = resolved.worktree;
    this.pr = resolved.pr;
    this.branchReview = resolved.branchReview;

    this.pty = spawn(resolved.executable ?? this.command, resolved.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: this.cwd,
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    });

    this.review = new ReviewAssistant(this.cwd, { agent: this.agent, model: this.model, reasoningEffort: this.reasoningEffort }, reviewDependencies);

    this.walkthrough = new WalkthroughService(this.review, this.worktree, () => this.diffBase(), () => this.reviewAssociation()?.number);

    this.pty.onData((data: string) => {
      this.scrollback = trimScrollback(this.scrollback, data);
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
      agent: this.agent,
      model: this.model,
      reasoningEffort: this.reasoningEffort,
      cwd: this.cwd,
      status: this.status,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      worktree: this.worktree,
      pr: this.pr,
      branchReview: this.branchReview,
    };
  }

  diffBase(): string | undefined {
    return this.branchReview?.baseSha ?? (this.pr ? `origin/${this.pr.baseRefName}` : undefined);
  }

  reviewAssociation(): PrAssociation | null {
    if (this.branchReview) return null;
    return this.pr ?? this.prLookup?.pr ?? null;
  }

  async prStatus(): Promise<PrStatus> {
    if (!this.worktree || this.branchReview) {
      return {
        pr: null,
        localDirty: false,
        localAhead: false,
        remoteAdvanced: false,
        remoteHeadSha: null,
        modifiedSinceHead: [],
      };
    }
    const { status, lookup } = await loadPrStatus(this.worktree, this.pr, this.prLookup);
    this.prLookup = lookup;
    return status;
  }

  async prThreads(): Promise<PrReviewThread[]> {
    const { pr } = await this.prStatus();
    if (!pr || !this.worktree) return [];
    return listPrThreads(this.worktree.repoRoot, pr);
  }

  private async reviewTarget(): Promise<{ pr: PrAssociation; repoRoot: string; status: PrStatus }> {
    const status = await this.prStatus();
    if (!status.pr || !this.worktree) {
      throw new Error("This session is not reviewing a pull request.");
    }
    return { pr: status.pr, repoRoot: this.worktree.repoRoot, status };
  }

  async submitReview(request: SubmitReviewRequest): Promise<void> {
    const { pr, repoRoot, status } = await this.reviewTarget();
    if (status.remoteAdvanced && !request.allowStale) {
      throw new Error(
        "The pull request head moved on GitHub since this session checked it out. Update to the PR head, or submit anyway to comment on the head you reviewed.",
      );
    }
    await submitPrReview(repoRoot, pr, request);
  }

  async replyToComment(commentId: number, body: string): Promise<void> {
    const { pr, repoRoot } = await this.reviewTarget();
    await replyToPrComment(repoRoot, pr, commentId, body);
  }

  async syncToPrHead(): Promise<PrStatus> {
    if (!this.worktree || !this.pr) {
      throw new Error("This session is not reviewing a pull request.");
    }
    const status = await this.prStatus();
    if (status.localDirty || status.localAhead) {
      throw new Error(
        "The worktree has local changes. Commit or discard them before updating to the PR head.",
      );
    }
    const headSha = await syncWorktreeToPrHead(this.worktree, this.pr);
    this.pr = { ...this.pr, headSha };
    this.prLookup = undefined;
    return this.prStatus();
  }

  terminal(): ShellTerminal {
    if (!this.shell || this.shell.status === "exited") this.shell = new ShellTerminal(this.cwd);
    return this.shell;
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
    this.disposed = true;
    this.navigation.dispose();
    const reviewStopped = this.review.dispose();
    this.shell?.dispose();
    if (this.status === "running") this.pty.kill();
    return reviewStopped;
  }

  private broadcast(message: ServerMessage) {
    for (const subscriber of this.subscribers) subscriber(message);
  }
}

export class SessionManager {
  constructor(
    private readonly resolveLaunch = resolveAgentLaunch,
    private readonly reviewDependencies: ReviewDependencies = {},
  ) {}

  private sessions = new Map<string, Session>();

  async create(project: Project, request: CreateSessionRequest): Promise<Session> {
    const resolved = await resolveSession(project, request, this.resolveLaunch);
    let session: Session;
    try {
      session = new Session(resolved, this.reviewDependencies);
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
    const stopped = session.dispose();
    this.sessions.delete(id);
    await stopped;
    if (session.worktree) {
      await removeWorktree(session.worktree).catch((error) => {
        console.warn(`failed to remove worktree for session ${id}:`, error);
      });
    }
    return true;
  }
}
