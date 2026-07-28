import type { CreateSessionRequest, SessionChanges, SessionInfo } from "@agent-manager/shared";

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

export function getSessionChanges(id: string): Promise<SessionChanges> {
  return fetch(`/api/sessions/${id}/changes`).then((r) => json<SessionChanges>(r));
}

export function openDiffInZed(id: string, path: string): Promise<void> {
  return fetch(`/api/sessions/${id}/open-diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).then((r) => json(r));
}
