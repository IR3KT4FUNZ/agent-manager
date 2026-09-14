import { useEffect, useRef, useState } from "react";
import type {
  Walkthrough,
  WalkthroughReference,
  WalkthroughState,
} from "@agent-manager/shared";
import { useCodeHistory } from "../lib/codeHistory";
import { useReview } from "../lib/review";
import {
  referenceView,
  resolveWalkthroughReference,
  useGenerateWalkthrough,
  useWalkthrough,
  useWalkthroughProgress,
} from "../lib/walkthrough";
import { ReviewConversation } from "./ReviewConversation";

const button =
  "rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40";

export function StartWalkthrough({ sessionId }: { sessionId: string }) {
  const generate = useGenerateWalkthrough(sessionId);
  const { data: review } = useReview(sessionId);
  const busy = review?.jobs.some(
    (job) =>
      job.kind === "walkthrough" &&
      ["accepted", "running"].includes(job.status),
  );
  return (
    <div className="shrink-0 border-b border-zinc-800 p-2">
      <button
        className={button}
        onClick={() => generate.mutate()}
        disabled={generate.isPending || busy}
      >
        Start walkthrough
      </button>
      {generate.error && (
        <p role="alert" className="mt-1 text-xs text-rose-300">
          {generate.error.message}
        </p>
      )}
    </div>
  );
}

export function WalkthroughPanel({ sessionId }: { sessionId: string }) {
  const { data, error } = useWalkthrough(sessionId);
  const generate = useGenerateWalkthrough(sessionId);
  const { data: review } = useReview(sessionId);
  const busy = review?.jobs.some(
    (job) =>
      job.kind === "walkthrough" &&
      ["accepted", "running"].includes(job.status),
  );
  return (
    <div className="h-full overflow-auto bg-zinc-900">
      <div className="space-y-2 border-b border-zinc-800 p-3 text-xs">
        <p className="text-zinc-400">
          Follow helpers into their uses, then review the overall impact.
        </p>
        <button
          className={button}
          onClick={() => generate.mutate()}
          disabled={generate.isPending || busy}
        >
          {busy
            ? "Generating…"
            : data?.walkthrough
              ? "Regenerate walkthrough"
              : "Generate walkthrough"}
        </button>
        {data?.phase !== "idle" && data?.phase && (
          <p role="status" className="text-sky-300">
            {data.phase}…
          </p>
        )}
        {(error || generate.error) && (
          <p role="alert" className="text-rose-300">
            {(error ?? generate.error)?.message}
          </p>
        )}
        {data?.stale && (
          <p role="alert" className="text-amber-300">
            Code changed since this walkthrough. Regenerate it to review the
            current changes.
          </p>
        )}
      </div>
      {data?.walkthrough ? (
        <WalkthroughSteps
          key={data.walkthrough.version}
          sessionId={sessionId}
          walkthrough={data.walkthrough}
          state={data}
        />
      ) : (
        <ReviewConversation key={sessionId} sessionId={sessionId} />
      )}
    </div>
  );
}

export function WalkthroughSteps({
  sessionId,
  walkthrough,
  state,
}: {
  sessionId: string;
  walkthrough: Walkthrough;
  state: Pick<WalkthroughState, "staleSteps">;
}) {
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const sequence = useRef(0);
  const { history } = useCodeHistory(sessionId);
  const { progress, mark } = useWalkthroughProgress(walkthrough.version);
  const step = walkthrough.steps[index]!;
  const stale = state.staleSteps.includes(step.id);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [sessionId, walkthrough.version],
  );
  async function openReference(reference: WalkthroughReference) {
    const request = ++sequence.current;
    setError(undefined);
    setOpening(true);
    try {
      const resolved = await resolveWalkthroughReference(
        sessionId,
        walkthrough.version,
        reference.nodeId,
      );
      if (request === sequence.current)
        history.visit(referenceView(resolved, walkthrough.version));
    } catch (error) {
      if (request === sequence.current)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === sequence.current) setOpening(false);
    }
  }
  function visit(next: number) {
    if (next < 0 || next >= walkthrough.steps.length) return;
    setIndex(next);
    const target = walkthrough.steps[next]!;
    if (!state.staleSteps.includes(target.id) && target.references[0])
      void openReference(target.references[0]);
  }
  return (
    <>
      <div className="space-y-3 p-3 text-xs">
        <nav aria-label="Walkthrough steps" className="space-y-1">
          {walkthrough.steps.map((item, position) => (
            <button
              key={item.id}
              aria-current={position === index ? "step" : undefined}
              onClick={() => visit(position)}
              className={`block w-full rounded px-2 py-1 text-left ${position === index ? "bg-zinc-700" : "text-zinc-400 hover:bg-zinc-800"}`}
            >
              {position + 1}. {item.title} ·{" "}
              {state.staleSteps.includes(item.id)
                ? "outdated"
                : (progress[item.id] ?? "unreviewed")}
            </button>
          ))}
        </nav>
        <p className="text-zinc-500">
          {index + 1} of {walkthrough.steps.length}
        </p>
        <h2 className="text-sm font-semibold">{step.title}</h2>
        {step.prerequisites.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-zinc-400">
            Depends on:
            {step.prerequisites.map((id) => (
              <button
                key={id}
                className={button}
                onClick={() =>
                  visit(walkthrough.steps.findIndex((step) => step.id === id))
                }
              >
                {walkthrough.steps.find((step) => step.id === id)?.title}
              </button>
            ))}
          </div>
        )}
        {stale && (
          <p role="alert" className="text-amber-300">
            This step is outdated. Regenerate before following its code
            highlights or requesting changes.
          </p>
        )}
        <p className="whitespace-pre-wrap leading-relaxed text-zinc-300">
          {step.explanation}
        </p>
        <div className="flex flex-wrap gap-1">
          {step.references.slice(0, 3).map((reference) => (
            <button
              key={reference.nodeId}
              className={button}
              disabled={stale || opening}
              onClick={() => void openReference(reference)}
            >
              {reference.path}:{reference.line} · {reference.side}
            </button>
          ))}
        </div>
        {step.references.length > 3 && (
          <details>
            <summary className="cursor-pointer text-sky-300">
              More code references ({step.references.length - 3})
            </summary>
            <div className="mt-2 flex flex-wrap gap-1">
              {step.references.slice(3).map((reference) => (
                <button
                  key={reference.nodeId}
                  className={button}
                  disabled={stale || opening}
                  onClick={() => void openReference(reference)}
                >
                  {reference.path}:{reference.line} · {reference.side}
                </button>
              ))}
            </div>
          </details>
        )}
        {step.details && (
          <details>
            <summary className="cursor-pointer text-sky-300">
              More detail
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-zinc-300">
              {step.details}
            </p>
          </details>
        )}
        {step.example && (
          <details>
            <summary className="cursor-pointer text-sky-300">
              Behavior example
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-zinc-300">
              {step.example}
            </p>
          </details>
        )}
        {step.reviewConsiderations && (
          <p className="whitespace-pre-wrap text-amber-200">
            Review considerations: {step.reviewConsiderations}
          </p>
        )}
        {error && (
          <p role="alert" className="text-rose-300">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={index === 0}
            onClick={() => visit(index - 1)}
          >
            Previous
          </button>
          <button
            className={button}
            disabled={stale}
            onClick={() => {
              mark(step.id, "reviewed");
              visit(index + 1);
            }}
          >
            Mark reviewed & next
          </button>
          <button
            className={button}
            disabled={index === walkthrough.steps.length - 1}
            onClick={() => visit(index + 1)}
          >
            Next
          </button>
          <button className={button} onClick={() => mark(step.id, "revisit")}>
            Revisit
          </button>
          <button
            className={button}
            disabled={stale || opening || !step.references[0]}
            onClick={() => void openReference(step.references[0]!)}
          >
            Return to step
          </button>
        </div>
        {walkthrough.uncoveredFiles.length > 0 && (
          <details>
            <summary className="text-amber-300">
              Outside this walkthrough ({walkthrough.uncoveredFiles.length}{" "}
              files)
            </summary>
            {walkthrough.uncoveredFiles.map((path) => (
              <button
                key={path}
                className="block p-1 text-sky-300"
                onClick={() => history.visit({ mode: "diff", path })}
              >
                {path}
              </button>
            ))}
          </details>
        )}
        {walkthrough.limitations.length > 0 && (
          <details>
            <summary className="text-zinc-400">Analysis limitations</summary>
            {walkthrough.limitations.map((text) => (
              <p key={text} className="mt-1 text-zinc-500">
                {text}
              </p>
            ))}
          </details>
        )}
      </div>
      <ReviewConversation
        sessionId={sessionId}
        stepId={step.id}
        walkthroughVersion={walkthrough.version}
        changeDisabled={stale}
      />
    </>
  );
}
