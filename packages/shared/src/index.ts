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
  pr?: PrAssociation;
}

export interface CreateSessionRequest {
  projectId: string;
  command?: string;
  args?: string[];
  title?: string;
  prNumber?: string | number;
}

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface ChangeEntry {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
}

export interface SessionChanges {
  base: string;
  files: ChangeEntry[];
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
  oldLine: number | null;
  newLine: number | null;
  noNewline?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  base: string;
  kind: "text" | "binary" | "too-large";
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  oldSize: number;
  newSize: number;
}

export interface GithubStatus {
  installed: boolean;
  authenticated: boolean;
  login?: string;
  message?: string;
}

export type PrState = "OPEN" | "CLOSED" | "MERGED";

export interface PrSummary {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  headRefName: string;
  author: string;
  updatedAt: string;
}

export interface PrAssociation {
  number: number;
  title: string;
  url: string;
  state: PrState;
  isDraft: boolean;
  baseRepo: string;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  isCrossRepository: boolean;
  author: string;
}

export type PrSide = "LEFT" | "RIGHT";

export interface PrCommentAnchor {
  path: string;
  line: number;
  side: PrSide;
  startLine?: number;
  startSide?: PrSide;
}

export interface PrReviewComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
}

export interface PrReviewThread {
  id: number;
  path: string;
  line: number | null;
  side: PrSide;
  startLine?: number;
  outdated: boolean;
  comments: PrReviewComment[];
}

export type PrReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface PrDraftComment {
  path: string;
  line: number;
  side: PrSide;
  startLine?: number;
  startSide?: PrSide;
  body: string;
}

export interface SubmitReviewRequest {
  event: PrReviewEvent;
  body?: string;
  comments: PrDraftComment[];
  allowStale?: boolean;
}

export interface ReplyRequest {
  body: string;
}

export interface PrStatus {
  pr: PrAssociation | null;
  localDirty: boolean;
  localAhead: boolean;
  remoteAdvanced: boolean;
  remoteHeadSha: string | null;
  modifiedSinceHead: string[];
}

export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

export type ServerMessage =
  | { type: "info"; session: SessionInfo }
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number };
