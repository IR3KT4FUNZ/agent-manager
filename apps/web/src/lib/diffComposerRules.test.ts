import { expect, test } from "bun:test";
import { agentQuestionDisabledReason, githubCommentDisabledReason } from "./diffComposerRules";

test("agent questions require a loaded, supported, running session in that order", () => {
  expect(agentQuestionDisabledReason()).toBe("Loading agent session…");
  expect(agentQuestionDisabledReason({ status: "exited" })).toBe(
    "Questions require a Claude or Codex session.",
  );
  expect(agentQuestionDisabledReason({ agent: "claude", status: "exited" })).toBe(
    "This agent has exited. Open a new session to ask a question.",
  );
  for (const agent of ["claude", "codex"] as const) {
    expect(agentQuestionDisabledReason({ agent, status: "running" })).toBeUndefined();
  }
});

const diff = { reviewAnchorsValid: true, reviewHeadSha: "head", currentVersion: "version" };
const context = { reviewHeadSha: "head", currentVersion: "version" };

test("GitHub availability checks PR association and known anchors before snapshot freshness", () => {
  const staleContext = { ...context, currentVersion: "old" };
  expect(githubCommentDisabledReason({ hasPr: false, context: staleContext })).toBe(
    "Open a PR session to draft GitHub comments.",
  );
  expect(githubCommentDisabledReason({ hasPr: true, context: staleContext })).toBe(
    "Checking PR review anchors…",
  );
  expect(githubCommentDisabledReason({
    hasPr: true,
    diff: { ...diff, reviewAnchorsValid: undefined },
    context: staleContext,
  })).toBe("Checking PR review anchors…");
  expect(githubCommentDisabledReason({
    hasPr: true,
    diff: { ...diff, reviewAnchorsValid: false },
    context: staleContext,
  })).toBe("Local changes no longer match the PR review anchors.");
});

test("GitHub comments require both the selected PR head and file version to match", () => {
  for (const staleContext of [
    { ...context, reviewHeadSha: "old-head" },
    { ...context, currentVersion: "old-version" },
  ]) {
    expect(githubCommentDisabledReason({ hasPr: true, diff, context: staleContext })).toBe(
      "The file changed after selection. Cancel and select its code again.",
    );
  }
  expect(githubCommentDisabledReason({ hasPr: true, diff, context })).toBeUndefined();
  expect(githubCommentDisabledReason({ hasPr: true, diff })).toBeUndefined();
});
