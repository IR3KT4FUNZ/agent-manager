import { homedir } from "node:os";
import type { CodexCatalog, CodexModel } from "@agent-manager/shared";

const INSTALL_MESSAGE = "Codex CLI not found. Install Codex CLI and make sure 'codex' is on PATH.";
const DISCOVERY_MESSAGE = "Could not load Codex models. Update Codex CLI and retry, or launch using Codex settings.";
const CACHE_MS = 5 * 60_000;

function parseModel(value: unknown): CodexModel {
  const model = value as Partial<CodexModel> | null;
  if (
    !model || typeof model.model !== "string" || !model.model ||
    typeof model.displayName !== "string" ||
    typeof model.defaultReasoningEffort !== "string" ||
    !Array.isArray(model.supportedReasoningEfforts) ||
    !model.supportedReasoningEfforts.every((effort) =>
      effort && typeof effort.reasoningEffort === "string" && typeof effort.description === "string",
    ) ||
    !model.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === model.defaultReasoningEffort)
  ) throw new Error("Unexpected model catalog format.");
  return {
    model: model.model,
    displayName: model.displayName,
    defaultReasoningEffort: model.defaultReasoningEffort,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
  };
}

export async function discoverCodexModels(binary: string, timeoutMs = 10_000): Promise<CodexModel[]> {
  const process = Bun.spawn([binary, "app-server", "--listen", "stdio://"], {
    cwd: homedir(), stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let stderr = "";
  const drainErrors = (async () => {
    for await (const chunk of process.stderr) {
      stderr = (stderr + new TextDecoder().decode(chunk)).slice(-4096);
    }
  })().catch(() => {});

  const send = (message: object) => {
    process.stdin.write(`${JSON.stringify(message)}\n`);
    process.stdin.flush();
  };
  async function reply(id: number): Promise<unknown> {
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } } | null;
        if (!message || typeof message !== "object") throw new Error("Unexpected Codex response.");
        if (message.id !== id) continue;
        if (message.error) throw new Error(message.error.message || "Codex rejected model discovery.");
        if (!("result" in message)) throw new Error("Unexpected Codex response.");
        return message.result;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error(stderr.trim() || "Codex exited before returning models.");
      buffered += decoder.decode(value, { stream: true });
      if (buffered.length > 2 * 1024 * 1024) throw new Error("Codex response exceeded the size limit.");
    }
  }

  async function discover() {
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "agent_manager", version: "0.1.0" } } });
    await reply(1);
    send({ method: "initialized" });
    const models = new Map<string, CodexModel>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let id = 2;
    do {
      send({ id, method: "model/list", params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
      const page = await reply(id++) as { data?: unknown[]; nextCursor?: unknown } | null;
      if (!page || !Array.isArray(page.data)) throw new Error("Unexpected model catalog format.");
      for (const item of page.data) {
        if (item && typeof item === "object" && "hidden" in item && item.hidden === true) continue;
        const model = parseModel(item);
        models.set(model.model, model);
      }
      const nextCursor = page.nextCursor ?? undefined;
      if (nextCursor !== undefined) {
        if (typeof nextCursor !== "string" || !nextCursor || cursors.has(nextCursor)) {
          throw new Error("Invalid model catalog cursor.");
        }
        cursors.add(nextCursor);
      }
      cursor = nextCursor;
    } while (cursor);
    return [...models.values()];
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      discover(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Codex model discovery timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    process.stdin.end();
    process.kill();
    const forceKill = setTimeout(() => process.kill(9), 250);
    try {
      await process.exited;
      await drainErrors;
    } finally {
      clearTimeout(forceKill);
      await reader.cancel().catch(() => {});
    }
  }
}

export class CodexModelCatalog {
  private cached?: { binary: string; at: number; models: CodexModel[] };
  private pending?: { binary: string; result: Promise<CodexCatalog> };

  constructor(
    private readonly findBinary = () => Bun.which("codex"),
    private readonly discover = discoverCodexModels,
    private readonly now = Date.now,
  ) {}

  async get(refresh = false): Promise<CodexCatalog> {
    const binary = this.findBinary();
    if (!binary) {
      this.cached = undefined;
      return { installed: false, models: [], error: INSTALL_MESSAGE };
    }
    if (this.pending?.binary === binary) return this.pending.result;
    if (!refresh && this.cached?.binary === binary && this.now() - this.cached.at < CACHE_MS) {
      return { installed: true, models: this.cached.models };
    }
    const result = this.discover(binary).then((models): CodexCatalog => {
      this.cached = { binary, at: this.now(), models };
      return { installed: true, models };
    }).catch((error): CodexCatalog => {
      this.cached = undefined;
      return { installed: true, models: [], error: `${DISCOVERY_MESSAGE} ${error instanceof Error ? error.message : String(error)}` };
    });
    this.pending = { binary, result };
    try {
      return await result;
    } finally {
      if (this.pending?.result === result) this.pending = undefined;
    }
  }
}

export const codexCatalog = new CodexModelCatalog();
