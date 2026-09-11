import type { AgentPreferences } from "../lib/agentPreferences";
import type { CodexCatalog } from "@agent-manager/shared";

const SELECT_CLASS = "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-zinc-500 focus:outline-none";

export function AgentControls({ preferences, onChange, catalog, loading, error, notice, onRetry }: {
  preferences: AgentPreferences;
  onChange: (next: AgentPreferences) => void;
  catalog?: CodexCatalog;
  loading: boolean;
  error?: string;
  notice: string;
  onRetry: () => void;
}) {
  const model = catalog?.models.find((item) => item.model === preferences.model);
  const message = error ?? catalog?.error;
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-xs text-zinc-400">
        <span>Agent</span>
        <select
          aria-label="Agent"
          className={SELECT_CLASS}
          value={preferences.agent}
          onChange={(event) => onChange({ ...preferences, agent: event.target.value as AgentPreferences["agent"] })}
        >
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      {preferences.agent === "codex" && (
        <>
          <label className="block space-y-1 text-xs text-zinc-400">
            <span>Model</span>
            <select
              aria-label="Model"
              className={SELECT_CLASS}
              value={preferences.model ?? ""}
              onChange={(event) => {
                const selected = catalog?.models.find((item) => item.model === event.target.value);
                onChange(selected
                  ? { agent: "codex", model: selected.model, reasoningEffort: selected.defaultReasoningEffort }
                  : { agent: "codex" });
              }}
            >
              <option value="">Use Codex settings</option>
              {preferences.model && !model && (
                <option value={preferences.model} disabled>{preferences.model} (awaiting model list)</option>
              )}
              {catalog?.models.map((item) => <option key={item.model} value={item.model}>{item.displayName}</option>)}
            </select>
          </label>
          {model && (
            <label className="block space-y-1 text-xs text-zinc-400">
              <span>Reasoning effort</span>
              <select
                aria-label="Reasoning effort"
                className={SELECT_CLASS}
                value={preferences.reasoningEffort ?? model.defaultReasoningEffort}
                onChange={(event) => onChange({ ...preferences, reasoningEffort: event.target.value })}
              >
                {model.supportedReasoningEfforts.map((effort) => (
                  <option key={effort.reasoningEffort} value={effort.reasoningEffort} title={effort.description}>
                    {effort.reasoningEffort}{effort.reasoningEffort === model.defaultReasoningEffort ? " (recommended)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {loading && <p className="text-xs text-zinc-500" role="status">Loading Codex models…</p>}
          {notice && <p className="text-xs text-amber-300" role="status">{notice}</p>}
          {message && (
            <div className="space-y-1 text-xs text-amber-300" role="alert">
              <p>{message}</p>
              <button type="button" onClick={onRetry} disabled={loading} className="underline disabled:opacity-50">Retry</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
