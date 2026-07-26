export const APP_NAME = "Agent Manager";

export interface SessionInfo {
  id: string;
  title: string;
  command: string;
  cwd: string;
  status: "running" | "exited";
  exitCode: number | null;
  createdAt: string;
}

export interface CreateSessionRequest {
  command?: string;
  args?: string[];
  cwd?: string;
  title?: string;
}

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

export type ServerMessage =
  | { type: "info"; session: SessionInfo }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number };
