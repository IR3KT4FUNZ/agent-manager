import type {
  CreateSessionRequest,
  FileDiff,
  GithubStatus,
  PrReviewThread,
  PrStatus,
  PrSummary,
  ProjectInfo,
  SessionChanges,
  SessionInfo,
  SubmitReviewRequest,
} from "@agent-manager/shared";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    let message = `${response.status} ${body}`;
    try {
      message = (JSON.parse(body) as { error?: string }).error ?? message;
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function listProjects(): Promise<ProjectInfo[]> {
  return fetch("/api/projects").then((r) => json<ProjectInfo[]>(r));
}

export function openProject(path?: string): Promise<ProjectInfo> {
  return fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).then((r) => json<ProjectInfo>(r));
}

export function closeProject(id: string): Promise<void> {
  return fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => json(r));
}

export function getGithubStatus(): Promise<GithubStatus> {
  return fetch("/api/github/status").then((r) => json<GithubStatus>(r));
}

export function listProjectPulls(projectId: string): Promise<PrSummary[]> {
  return fetch(`/api/projects/${projectId}/pulls`).then((r) => json<PrSummary[]>(r));
}

export function listSessions(): Promise<SessionInfo[]> {
  return fetch("/api/sessions").then((r) => json<SessionInfo[]>(r));
}

export function createSession(request: CreateSessionRequest): Promise<SessionInfo> {
  return fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }).then((r) => json<SessionInfo>(r));
}

export function deleteSession(id: string): Promise<void> {
  return fetch(`/api/sessions/${id}`, { method: "DELETE" }).then((r) => json(r));
}

export function getSessionPr(id: string): Promise<PrStatus> {
  return fetch(`/api/sessions/${id}/pr`).then((r) => json<PrStatus>(r));
}

export function getSessionPrComments(id: string): Promise<PrReviewThread[]> {
  return fetch(`/api/sessions/${id}/pr/comments`).then((r) => json<PrReviewThread[]>(r));
}

export function submitPrReview(id: string, request: SubmitReviewRequest): Promise<void> {
  return fetch(`/api/sessions/${id}/pr/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  }).then((r) => json(r));
}

export function replyToPrComment(id: string, commentId: number, body: string): Promise<void> {
  return fetch(`/api/sessions/${id}/pr/comments/${commentId}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  }).then((r) => json(r));
}

export function syncSessionPr(id: string): Promise<PrStatus> {
  return fetch(`/api/sessions/${id}/pr/sync`, { method: "POST" }).then((r) => json<PrStatus>(r));
}

export function getSessionChanges(id: string): Promise<SessionChanges> {
  return fetch(`/api/sessions/${id}/changes`).then((r) => json<SessionChanges>(r));
}

export function getFileDiff(id: string, path: string): Promise<FileDiff> {
  return fetch(`/api/sessions/${id}/diff?path=${encodeURIComponent(path)}`).then((r) =>
    json<FileDiff>(r),
  );
}
