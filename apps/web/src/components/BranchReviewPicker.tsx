import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BranchReviewRequest } from "@agent-manager/shared";
import { listProjectBranches } from "../lib/api";

function BranchRefPicker({ label, value, branches, disabled, onChange }: {
  label: string;
  value: string;
  branches: string[];
  disabled: boolean;
  onChange: (ref: string) => void;
}) {
  const [custom, setCustom] = useState(false);
  const options = [...new Set([...branches, "HEAD"])];
  const isCustom = custom || Boolean(value && !options.includes(value));
  const fieldClass = "w-full min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100";

  return (
    <div className="space-y-1">
      <label className="block space-y-1 text-zinc-400">
        <span>{label}</span>
        <select value={isCustom ? ":" : value} disabled={disabled} className={fieldClass}
          onChange={(event) => {
            const next = event.target.value;
            setCustom(next === ":");
            onChange(next === ":" ? "" : next);
          }}>
          <option value="" disabled>Choose a branch</option>
          {options.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          <option value=":">Other ref or commit…</option>
        </select>
      </label>
      {isCustom && (
        <input aria-label={`${label} ref or commit`} autoFocus value={value} disabled={disabled}
          onChange={(event) => onChange(event.target.value)} placeholder="Branch, tag, or commit"
          className={fieldClass} />
      )}
    </div>
  );
}

export function BranchReviewPicker({ projectId, pending, onOpen, onCancel }: {
  projectId: string;
  pending: boolean;
  onOpen: (review: BranchReviewRequest) => void;
  onCancel: () => void;
}) {
  const [headRef, setHeadRef] = useState<string>();
  const [baseRef, setBaseRef] = useState<string>();
  const { data, error, isLoading } = useQuery({
    queryKey: ["branches", projectId],
    queryFn: () => listProjectBranches(projectId),
    staleTime: 0,
  });
  const head = headRef ?? data?.currentBranch ?? "";
  const base = baseRef ?? data?.defaultBase ?? "";
  const disabled = pending || !head.trim() || !base.trim();

  return (
    <form aria-label="Review branch diff" className="space-y-2 px-2 pb-1 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onOpen({ headRef: head.trim(), baseRef: base.trim() });
      }}>
      <BranchRefPicker label="Branch to review" value={head} branches={data?.branches ?? []}
        disabled={pending} onChange={setHeadRef} />
      <BranchRefPicker label="Base branch" value={base} branches={data?.branches ?? []}
        disabled={pending} onChange={setBaseRef} />
      <p className="text-zinc-500">Review changes since the common ancestor in a new workspace. Uses local refs, including fetched remote branches.</p>
      {isLoading && <p className="text-zinc-500">Loading branches…</p>}
      {error && <p role="alert" className="text-rose-400">{error.message}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={disabled}
          className="rounded bg-zinc-100 px-2 py-1 font-medium text-zinc-900 disabled:opacity-50">
          {pending ? "Opening…" : "Review diff"}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="px-2 py-1 text-zinc-400">Cancel</button>
      </div>
    </form>
  );
}
