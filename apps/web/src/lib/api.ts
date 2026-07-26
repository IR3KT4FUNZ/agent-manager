import type { CreateSessionRequest, SessionInfo } from "@agent-manager/shared";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
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
