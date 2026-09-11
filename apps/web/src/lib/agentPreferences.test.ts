import { expect, test } from "bun:test";
import { launchSelection, reconcileAgentPreferences, sanitizeAgentPreferences } from "./agentPreferences";
import type { CodexModel } from "@agent-manager/shared";

const model: CodexModel = {
  model: "test-model", displayName: "Test Model", defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced" }],
};

test("preferences default to Claude and restore a saved Codex selection", () => {
  for (const saved of [null, {}, 123, { agent: "other", model: 5 }]) {
    expect(sanitizeAgentPreferences(saved)).toEqual({ agent: "claude" });
  }
  expect(sanitizeAgentPreferences({ agent: "codex", model: "test-model", reasoningEffort: "medium" })).toEqual({
    agent: "codex", model: "test-model", reasoningEffort: "medium",
  });
  expect(sanitizeAgentPreferences({ agent: "codex", reasoningEffort: "high" })).toEqual({ agent: "codex" });
});

test("catalog refresh clears missing models and replaces unsupported effort", () => {
  const preferences = { agent: "codex" as const, model: "test-model", reasoningEffort: "medium" };
  expect(reconcileAgentPreferences(preferences, [model])).toBe(preferences);
  expect(reconcileAgentPreferences(preferences, [])).toEqual({ agent: "codex" });
  expect(reconcileAgentPreferences({ ...preferences, reasoningEffort: "ultra" }, [model])).toEqual(preferences);
});

test("launch snapshots exclude saved Codex options for Claude and do not follow later edits", () => {
  const preferences = { agent: "claude" as const, model: "test-model", reasoningEffort: "medium" };
  expect(launchSelection(preferences)).toEqual({ agent: "claude" });
  const codex = { ...preferences, agent: "codex" as const };
  const snapshot = launchSelection(codex);
  codex.model = "another-model";
  expect(snapshot.model).toBe("test-model");
  expect(preferences.model).toBe("test-model");
});
