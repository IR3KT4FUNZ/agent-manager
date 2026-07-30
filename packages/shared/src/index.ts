export const APP_NAME = "Agent Manager";

export interface WorktreeInfo {
  path: string;
  branch: string;
  repoRoot: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  isRepo: boolean;
  createdAt: string;
}

export interface OpenProjectRequest {
  path?: string;
}

export interface SessionInfo {
  id: string;
  projectId: string;
  title: string;
  command: string;
  cwd: string;
  status: "running" | "exited";
  exitCode: number | null;
  createdAt: string;
  worktree?: WorktreeInfo;
}

export interface CreateSessionRequest {
  projectId: string;
  command?: string;
  args?: string[];
  title?: string;
}

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface ChangeEntry {
  path: string;
  status: ChangeStatus;
}

export interface SessionChanges {
  base: string;
  files: ChangeEntry[];
}

export interface OpenDiffRequest {
  path: string;
}

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

export type ServerMessage =
  | { type: "info"; session: SessionInfo }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number };
