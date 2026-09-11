import { contextPreview, diffComposers, type ComposerDraft } from "../lib/diffComposer";

export function DiffComposer({ draft, githubDisabled, agentDisabled, onReview }: {
  draft: ComposerDraft;
  githubDisabled?: string;
  agentDisabled?: string;
  onReview: (body: string) => void;
}) {
  const github = draft.destination === "github";
  const disabled = github ? githubDisabled : agentDisabled;
  return (
    <form aria-label="Selected code composer" className="space-y-2 font-sans text-xs" onSubmit={event => {
      event.preventDefault();
      if (disabled || draft.pending || !draft.text.trim()) return;
      if (github) onReview(draft.text.trim());
      else void diffComposers.send(draft.id);
    }}>
      <label className="flex items-center gap-2">
        Destination
        <select aria-label="Destination" value={draft.destination} disabled={draft.pending}
          onChange={event => diffComposers.update(draft.id, { destination: event.target.value as "agent" | "github" })}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1">
          <option value="agent">Agent question</option>
          <option value="github" disabled={Boolean(githubDisabled)}>GitHub comment</option>
        </select>
      </label>
      <p className="break-all text-zinc-400">Selected diff context: {draft.context.path} · {draft.context.side} side · lines {draft.context.startLine}–{draft.context.endLine}</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-anywhere rounded bg-zinc-950 p-2 font-mono text-zinc-300">{contextPreview(draft.context)}</pre>
      {githubDisabled && <p className="text-zinc-500">GitHub comment unavailable: {githubDisabled}</p>}
      {!github && <p className="text-zinc-500">Sends to this session’s agent terminal using its current input. The answer appears in Chat.</p>}
      {disabled && (!github || !githubDisabled) && <p className="text-amber-300">{disabled}</p>}
      <textarea aria-label="Question or comment" autoFocus value={draft.text} disabled={draft.pending} rows={3}
        placeholder={github ? "Write a review comment…" : "Ask about this code…"}
        onChange={event => diffComposers.update(draft.id, { text: event.target.value })}
        className="w-full resize-y rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-100" />
      {draft.error && <p role="alert" className="text-rose-300">{draft.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={Boolean(disabled) || draft.pending || !draft.text.trim()}
          className="rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-40">{draft.pending ? "Submitting…" : github ? "Add to review" : "Ask agent"}</button>
        <button type="button" disabled={draft.pending} onClick={() => diffComposers.cancel(draft.id)}
          className="px-2 py-1 text-zinc-400 disabled:opacity-40">Cancel</button>
      </div>
    </form>
  );
}
