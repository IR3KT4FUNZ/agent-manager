import { useQuery } from "@tanstack/react-query";
import type {
  AgentSelection,
  AskAgentResult,
  ReviewRequest,
  ReviewState,
} from "@agent-manager/shared";
import { ApiError } from "./api";

async function request<T>(
  sessionId: string,
  path = "",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api/sessions/${sessionId}/review${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      value.error ?? "Review request failed.",
      response.status,
    );
  return value;
}
export const sendReviewMessage = (sessionId: string, value: ReviewRequest) =>
  request<AskAgentResult>(sessionId, "/messages", value);
export const configureReviewAgent = (
  sessionId: string,
  selection: AgentSelection,
) => request<ReviewState>(sessionId, "/agent", selection);
export const cancelReviewJob = (sessionId: string, id: string) =>
  request(sessionId, `/jobs/${id}/cancel`, {});
export function useReview(sessionId: string) {
  return useQuery({
    queryKey: ["review", sessionId],
    queryFn: () => request<ReviewState>(sessionId),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) =>
        ["accepted", "running"].includes(job.status),
      )
        ? 1000
        : 3000,
  });
}
