import { useEffect, useState } from "react";
import type { AgentId, AgentSelection, CodexModel } from "@agent-manager/shared";

export interface AgentPreferences {
  agent: AgentId;
  model?: string;
  reasoningEffort?: string;
}

export const AGENT_PREFERENCES_KEY = "agent-manager.agent-preferences";

export function sanitizeAgentPreferences(value: unknown): AgentPreferences {
  const saved = value as Partial<AgentPreferences> | null;
  return {
    agent: saved?.agent === "codex" ? "codex" : "claude",
    ...(typeof saved?.model === "string" && saved.model.trim()
      ? { model: saved.model, ...(typeof saved.reasoningEffort === "string" && saved.reasoningEffort.trim() ? { reasoningEffort: saved.reasoningEffort } : {}) }
      : {}),
  };
}

export function reconcileAgentPreferences(preferences: AgentPreferences, models: CodexModel[]): AgentPreferences {
  if (!preferences.model) return preferences;
  const model = models.find((item) => item.model === preferences.model);
  if (!model) return { agent: preferences.agent };
  if (model.supportedReasoningEfforts.some((item) => item.reasoningEffort === preferences.reasoningEffort)) return preferences;
  return { ...preferences, reasoningEffort: model.defaultReasoningEffort };
}

export function launchSelection(preferences: AgentPreferences): AgentSelection {
  return preferences.agent === "claude" ? { agent: "claude" } : { ...preferences };
}

function loadPreferences(): AgentPreferences {
  try {
    return sanitizeAgentPreferences(JSON.parse(localStorage.getItem(AGENT_PREFERENCES_KEY) ?? "null"));
  } catch {
    return { agent: "claude" };
  }
}

export function useAgentPreferences() {
  const [preferences, setPreferences] = useState(loadPreferences);
  useEffect(() => {
    try {
      localStorage.setItem(AGENT_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {}
  }, [preferences]);
  return { preferences, setPreferences };
}
