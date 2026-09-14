import type { AgentSelection, DiffSelectionContext } from "./index";
import type { CodeReference } from "./walkthrough";

export type ReviewMode = "ask" | "change";
export type ReviewJobStatus =
  "accepted" | "running" | "completed" | "failed" | "cancelled";
export interface ReviewRequest {
  requestId: string;
  question: string;
  mode?: ReviewMode;
  context?: DiffSelectionContext;
  stepId?: string;
  walkthroughVersion?: string;
  selection?: AgentSelection;
}
export interface ReviewStepContext {
  title: string;
  explanation: string;
  references: CodeReference[];
}
export interface ReviewJob {
  id: string;
  kind: "message" | "walkthrough";
  status: ReviewJobStatus;
  question: string;
  mode: ReviewMode;
  context?: DiffSelectionContext;
  stepId?: string;
  walkthroughVersion?: string;
  answer?: string;
  stepContext?: ReviewStepContext;
  changedFiles?: string[];
  error?: string;
  createdAt: string;
}
export interface ReviewState {
  selection: AgentSelection;
  jobs: ReviewJob[];
}
