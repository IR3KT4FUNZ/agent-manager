import type { ChangeEvent, FormEvent } from "react";
import { contextPreview, diffComposers, type ComposerDraft } from "../lib/diffComposer";

interface DiffComposerProps {
  draft: ComposerDraft;
  githubDisabled?: string;
  hasPr: boolean;
  agentDisabled?: string;
  onReview: (body: string) => void;
}

export function DiffComposer({
  draft,
  githubDisabled,
  hasPr,
  agentDisabled,
  onReview,
}: DiffComposerProps) {
  const isGithubComment = draft.destination === "github";
  const disabledReason = isGithubComment ? githubDisabled : agentDisabled;
  const canSubmit = !disabledReason && !draft.pending && Boolean(draft.text.trim());
  const submitLabel = draft.pending ? "Submitting…" : isGithubComment ? "Add to review" : draft.mode === "change" ? "Request change" : "Ask agent";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    if (isGithubComment) onReview(draft.text.trim());
    else void diffComposers.send(draft.id);
  }

  function changeDestination(event: ChangeEvent<HTMLSelectElement>) {
    const destination = event.target.value as ComposerDraft["destination"];
    diffComposers.update(draft.id, { destination });
  }

  return (
    <form
      aria-label="Selected code composer"
      className="space-y-2 font-sans text-xs"
      onSubmit={submit}
    >
      {hasPr && <label className="flex items-center gap-2">
        Destination
        <select
          aria-label="Destination"
          value={draft.destination}
          disabled={draft.pending}
          onChange={changeDestination}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
        >
          <option value="agent">Agent question</option>
          <option value="github" disabled={Boolean(githubDisabled)}>GitHub comment</option>
        </select>
      </label>}
      <p className="break-all text-zinc-400">
        Selected diff context: {draft.context.path} · {draft.context.side} side · lines {draft.context.startLine}–{draft.context.endLine}
      </p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap wrap-anywhere rounded bg-zinc-950 p-2 font-mono text-zinc-300">
        {contextPreview(draft.context)}
      </pre>
      {hasPr && githubDisabled && (
        <p className="text-zinc-500">GitHub comment unavailable: {githubDisabled}</p>
      )}
      {!isGithubComment && (
        <p className="text-zinc-500">
          Sends to the dedicated review assistant. The answer appears in Walkthrough.
        </p>
      )}
      {disabledReason && (!isGithubComment || !githubDisabled) && (
        <p className="text-amber-300">{disabledReason}</p>
      )}
      {!isGithubComment && (
        <label className="flex items-center gap-2">Action
          <select aria-label="Review action" value={draft.mode ?? "ask"} disabled={draft.pending}
            onChange={event => diffComposers.update(draft.id, { mode: event.target.value as "ask" | "change" })}
            className="rounded bg-zinc-800 p-1">
            <option value="ask">Explain code</option><option value="change">Request change</option>
          </select>
        </label>
      )}
      <textarea
        aria-label="Question or comment"
        autoFocus
        value={draft.text}
        disabled={draft.pending}
        rows={3}
        placeholder={isGithubComment ? "Write a review comment…" : "Ask about this code…"}
        onChange={(event) => diffComposers.update(draft.id, { text: event.target.value })}
        className="w-full resize-y rounded border border-zinc-700 bg-zinc-900 p-2 text-zinc-100"
      />
      {draft.error && <p role="alert" className="text-rose-300">{draft.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-40"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          disabled={draft.pending}
          onClick={() => diffComposers.cancel(draft.id)}
          className="px-2 py-1 text-zinc-400 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
