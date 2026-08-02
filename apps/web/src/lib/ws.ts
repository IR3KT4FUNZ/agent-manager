export function sessionWsPath(id: string): string {
  return `/ws/sessions/${id}`;
}

export function terminalWsPath(id: string): string {
  return `/ws/sessions/${id}/terminal`;
}

export function wsUrl(base: string, path: string): string {
  return `${base}${path}`;
}
