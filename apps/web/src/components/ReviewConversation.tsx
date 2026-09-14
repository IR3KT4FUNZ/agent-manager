import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentId, ReviewMode, ReviewRequest } from "@agent-manager/shared";
import {
  cancelReviewJob,
  configureReviewAgent,
  sendReviewMessage,
  useReview,
} from "../lib/review";

export function ReviewConversation({
  sessionId,
  stepId,
  walkthroughVersion,
  changeDisabled = false,
}: {
  sessionId: string;
  stepId?: string;
  walkthroughVersion?: string;
  changeDisabled?: boolean;
}) {
  const client = useQueryClient();
  const { data, error } = useReview(sessionId);
  const latestMessage = useRef<HTMLElement>(null);
  const latest = data?.jobs.at(-1);
  useEffect(() => {
    if (latest?.kind === "message")
      latestMessage.current?.scrollIntoView?.({ block: "nearest" });
  }, [latest?.id, latest?.status]);
  const [agent, setAgent] = useState<AgentId>("claude");
  const [text, setText] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["review", sessionId] });
  const configure = useMutation({
    mutationFn: () => configureReviewAgent(sessionId, { agent }),
    onSuccess: refresh,
  });
  const send = useMutation({
    mutationFn: (request: ReviewRequest) =>
      sendReviewMessage(sessionId, request),
    onSuccess: () => {
      setText("");
      setRequestId(crypto.randomUUID());
      void refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelReviewJob(sessionId, id),
    onSuccess: refresh,
  });
  function submit(mode: ReviewMode) {
    if (!text.trim() || send.isPending) return;
    send.mutate({
      requestId: `${requestId}-${mode}`,
      question: text.trim(),
      mode,
      stepId,
      walkthroughVersion,
    });
  }
  return (
    <section aria-label="Review conversation" className="space-y-3 p-3 text-xs">
      {!data?.selection.agent && (
        <div className="flex items-center gap-2">
          <select
            aria-label="Review agent"
            value={agent}
            onChange={(event) => setAgent(event.target.value as AgentId)}
            className="rounded bg-zinc-800 p-2"
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>
          <button
            onClick={() => configure.mutate()}
            disabled={configure.isPending}
            className="rounded bg-zinc-700 p-2"
          >
            Use for review
          </button>
        </div>
      )}
      <p className="text-zinc-500">
        {data?.selection.agent
          ? `${data.selection.agent === "codex" ? "Codex" : "Claude"} review assistant`
          : "Choose an agent to review this session."}
      </p>
      {data?.jobs.map((job) => (
        <article
          key={job.id}
          ref={job.id === latest?.id ? latestMessage : undefined}
          className="space-y-2 rounded border border-zinc-800 p-2"
        >
          <p className="whitespace-pre-wrap text-zinc-200">{job.question}</p>
          {job.context && (
            <p className="text-zinc-500">
              {job.context.path} · {job.context.side} lines{" "}
              {job.context.startLine}–{job.context.endLine}
            </p>
          )}
          {job.stepId && (
            <p className="text-zinc-500">
              Step {job.stepId} · walkthrough{" "}
              {job.walkthroughVersion?.slice(0, 8)}
            </p>
          )}
          <p role="status" className="text-zinc-500">
            {job.mode === "change" ? "Change request" : "Review"} · {job.status}
          </p>
          {job.stepContext && (
            <details className="text-zinc-400">
              <summary>Original step: {job.stepContext.title}</summary>
              <p className="mt-1 whitespace-pre-wrap">
                {job.stepContext.explanation}
              </p>
            </details>
          )}
          {job.answer && (
            <p className="whitespace-pre-wrap text-zinc-300">{job.answer}</p>
          )}
          {job.changedFiles && (
            <p className="text-sky-300">
              Changed files: {job.changedFiles.join(", ") || "none"}
            </p>
          )}
          {job.error && (
            <p role="alert" className="text-rose-300">
              {job.error}
            </p>
          )}
          {["accepted", "running"].includes(job.status) && (
            <button
              onClick={() => cancel.mutate(job.id)}
              className="text-zinc-400"
            >
              Cancel request
            </button>
          )}
          {["failed", "cancelled"].includes(job.status) &&
            job.kind === "message" && (
              <button
                onClick={() => {
                  setText(job.question);
                  setRequestId(crypto.randomUUID());
                }}
                className="text-sky-300"
              >
                Prepare a new request
              </button>
            )}
        </article>
      ))}
      <textarea
        aria-label="Ask the review assistant"
        value={text}
        rows={3}
        placeholder={
          stepId ? "Ask about this step…" : "Ask about these changes…"
        }
        onChange={(event) => {
          setText(event.target.value);
          setRequestId(crypto.randomUUID());
        }}
        className="w-full resize-y rounded bg-zinc-950 p-2"
      />
      <div className="flex gap-2">
        <button
          onClick={() => submit("ask")}
          disabled={!text.trim() || !data?.selection.agent || send.isPending}
          className="rounded bg-sky-700 px-3 py-2 disabled:opacity-40"
        >
          Ask
        </button>
        <button
          onClick={() => submit("change")}
          disabled={
            changeDisabled ||
            !text.trim() ||
            !data?.selection.agent ||
            send.isPending
          }
          className="rounded bg-zinc-700 px-3 py-2 disabled:opacity-40"
        >
          Request change
        </button>
      </div>
      <p className="text-zinc-500">
        Ask explains code. Request change allows edits in this session’s
        worktree.
      </p>
      {(error || send.error || configure.error || cancel.error) && (
        <p role="alert" className="text-rose-300">
          {(error ?? send.error ?? configure.error ?? cancel.error)?.message}
        </p>
      )}
    </section>
  );
}
