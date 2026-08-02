export const SCROLLBACK_LIMIT = 400_000;

export function trimScrollback(buffer: string, data: string, limit = SCROLLBACK_LIMIT): string {
  return (buffer + data).slice(-limit);
}
