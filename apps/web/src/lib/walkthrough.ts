import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  SourceDocument,
  WalkthroughReference,
  WalkthroughState,
} from "@agent-manager/shared";
import { ApiError } from "./api";
import { diffComposers } from "./diffComposer";

export type StepProgress = "unreviewed" | "reviewed" | "revisit";
async function request<T>(
  sessionId: string,
  suffix = "",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/sessions/${sessionId}/walkthrough${suffix}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error ?? "Walkthrough request failed.",
      response.status,
    );
  return data;
}
export function useWalkthrough(sessionId: string) {
  return useQuery({
    queryKey: ["walkthrough", sessionId],
    queryFn: () => request<WalkthroughState>(sessionId),
    refetchInterval: 3000,
  });
}
export function useGenerateWalkthrough(sessionId: string) {
  const client = useQueryClient();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return useMutation({
    mutationFn: () => request(sessionId, "", { requestId }),
    onSuccess: () => {
      setRequestId(crypto.randomUUID());
      diffComposers.revealReview(sessionId);
      void client.invalidateQueries({ queryKey: ["review", sessionId] });
      void client.invalidateQueries({ queryKey: ["walkthrough", sessionId] });
    },
  });
}
export const resolveWalkthroughReference = (
  sessionId: string,
  version: string,
  nodeId: string,
) =>
  request<WalkthroughReference>(
    sessionId,
    `/reference/${encodeURIComponent(nodeId)}?version=${encodeURIComponent(version)}`,
  );
export const getWalkthroughSource = (
  sessionId: string,
  version: string,
  nodeId: string,
) =>
  request<SourceDocument>(
    sessionId,
    `/source/${encodeURIComponent(nodeId)}?version=${encodeURIComponent(version)}`,
  );

export function sanitizeProgress(value: unknown): Record<string, StepProgress> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, status]) =>
      ["unreviewed", "reviewed", "revisit"].includes(status as string),
    ),
  );
}
export function useWalkthroughProgress(version: string) {
  const key = `agent-manager.walkthrough-progress.${version}`;
  const [progress, setProgress] = useState<Record<string, StepProgress>>(() => {
    try {
      return sanitizeProgress(JSON.parse(localStorage.getItem(key) ?? "{}"));
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(progress));
    } catch {}
  }, [key, progress]);
  const mark = (id: string, status: StepProgress) =>
    setProgress((current) => ({ ...current, [id]: status }));
  return { progress, mark };
}

export function referenceView(
  reference: WalkthroughReference,
  version: string,
) {
  return {
    mode: reference.diffPath ? ("diff" as const) : ("source" as const),
    path: reference.diffPath ?? reference.path,
    side: reference.side,
    line: reference.diffLine ?? reference.line,
    endLine: reference.diffEndLine ?? reference.endLine,
    column: 1,
    version: reference.diffPath ? reference.currentVersion : reference.version,
    baseVersion: reference.baseVersion,
    walkthrough: { version, nodeId: reference.nodeId, side: reference.side },
  };
}
