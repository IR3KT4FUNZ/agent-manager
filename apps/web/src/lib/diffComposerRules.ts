import type { DiffSelectionContext, FileDiff, SessionInfo } from "@agent-manager/shared";
import type { SelectionAnchor } from "./diffComposer";

export function agentQuestionDisabledReason(session?: Pick<SessionInfo, "agent" | "status">) {
  if (!session) return "Loading agent session…";
  if (!session.agent) return "Questions require a Claude or Codex session.";
  if (session.status !== "running") {
    return "This agent has exited. Open a new session to ask a question.";
  }
  return undefined;
}

export function githubCommentDisabledReason({ hasPr, diff, context }: {
  hasPr: boolean;
  diff?: Pick<FileDiff, "reviewAnchorsValid" | "reviewHeadSha" | "currentVersion">;
  context?: Pick<DiffSelectionContext, "reviewHeadSha" | "currentVersion">;
}) {
  if (!hasPr) return "Open a PR session to draft GitHub comments.";
  if (diff?.reviewAnchorsValid === undefined) return "Checking PR review anchors…";
  if (!diff.reviewAnchorsValid) return "Local changes no longer match the PR review anchors.";
  if (context && (
    context.reviewHeadSha !== diff.reviewHeadSha || context.currentVersion !== diff.currentVersion
  )) {
    return "The file changed after selection. Cancel and select its code again.";
  }
  return undefined;
}

export function isDiffAnchorVisible(diff: FileDiff | undefined, anchor: SelectionAnchor) {
  return diff?.hunks.some((hunk) => hunk.lines.some((line) => {
    const lineNumber = anchor.side === "LEFT" ? line.oldLine : line.newLine;
    return lineNumber === anchor.line;
  })) ?? false;
}
