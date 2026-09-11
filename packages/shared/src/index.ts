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

export type AgentId = "claude" | "codex";

export interface AgentSelection {
  agent?: AgentId;
  model?: string;
  reasoningEffort?: string;
}

export interface CodexModel {
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}

export interface CodexCatalog {
  installed: boolean;
  models: CodexModel[];
  error?: string;
}

export interface SessionInfo extends AgentSelection {
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

export interface CreateSessionRequest extends AgentSelection {
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
  reviewHeadSha?: string;
  reviewAnchorsValid?: boolean;
  currentVersion?: string;
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

export interface SourceDocument {
  path: string;
  content: string;
  version: string;
  language: "typescript" | "javascript" | "plaintext";
}

export interface NavigationRequest {
  action: "definition" | "references";
  path: string;
  line: number;
  column: number;
  version: string;
}

export interface SourceLocation {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  version: string;
  preview: string;
}

export interface NavigationResult {
  locations: SourceLocation[];
  message?: string;
}

export interface DiffSelectionContext {
  path: string;
  side: "old" | "new";
  startLine: number;
  endLine: number;
  lines: { line: number; text: string }[];
  base: string;
  currentVersion?: string;
  selectedAt: string;
  reviewHeadSha?: string;
}

export interface AskAgentRequest {
  requestId: string;
  question: string;
  context: DiffSelectionContext;
}

export interface AskAgentResult {
  requestId: string;
  status: "submitted";
}
