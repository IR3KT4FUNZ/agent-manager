import { createHash } from "node:crypto";
import type { AskAgentRequest, AskAgentResult, AgentId } from "@agent-manager/shared";

export const MAX_QUESTION_BYTES = 64 * 1024;

export class QuestionError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 413 = 400) { super(message); }
}

export function safeTerminalText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

export function validateQuestion(value: unknown): AskAgentRequest {
  if (!value || typeof value !== "object") throw new QuestionError("Invalid agent question.");
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_QUESTION_BYTES) throw new QuestionError("Question and selected code exceed 64 KiB. Select fewer lines or shorten the question.", 413);
  const { requestId, question, context } = value as AskAgentRequest;
  const positive = (number: number) => Number.isSafeInteger(number) && number > 0;
  if (typeof requestId !== "string" || !/^[\w-]{1,100}$/.test(requestId)) throw new QuestionError("Invalid question request ID.");
  if (typeof question !== "string" || !safeTerminalText(question).trim()) throw new QuestionError("Enter a question for the agent.");
  if (!context || typeof context.path !== "string" || !context.path || context.path.startsWith("/") || context.path.split(/[\\/]/).includes("..") || /[\x00-\x1f\x7f-\x9f]/.test(context.path) ||
    !["old", "new"].includes(context.side) || !positive(context.startLine) || !positive(context.endLine) || context.endLine < context.startLine ||
    typeof context.base !== "string" || typeof context.selectedAt !== "string" || !Number.isFinite(Date.parse(context.selectedAt)) ||
    (context.currentVersion !== undefined && (typeof context.currentVersion !== "string" || !/^[a-f0-9]{64}$/.test(context.currentVersion))) ||
    (context.reviewHeadSha !== undefined && (typeof context.reviewHeadSha !== "string" || !/^[a-f0-9]{40,64}$/.test(context.reviewHeadSha))) ||
    !Array.isArray(context.lines) || !context.lines.length) throw new QuestionError("Invalid selected code context.");
  let previous = context.startLine - 1;
  for (const item of context.lines) {
    if (!item || !positive(item.line) || item.line <= previous || item.line > context.endLine || typeof item.text !== "string" || /[\r\n]/.test(item.text)) throw new QuestionError("Invalid selected code lines.");
    previous = item.line;
  }
  if (context.lines[0]!.line !== context.startLine || context.lines.at(-1)!.line !== context.endLine) throw new QuestionError("Selected code does not match its line range.");
  return {
    requestId, question,
    context: {
      path: context.path, side: context.side, startLine: context.startLine, endLine: context.endLine,
      lines: context.lines.map(({ line, text }) => ({ line, text })),
      base: context.base, selectedAt: context.selectedAt,
      currentVersion: context.currentVersion, reviewHeadSha: context.reviewHeadSha,
    },
  };
}

export function formatQuestion(request: AskAgentRequest): string {
  const { context } = request;
  const excerpt: string[] = [];
  let previous = context.startLine - 1;
  for (const item of context.lines) {
    if (item.line > previous + 1) excerpt.push("[intervening lines not displayed in the selected diff]");
    excerpt.push(`${item.line}: ${safeTerminalText(item.text)}`);
    previous = item.line;
  }
  const content = excerpt.join("\n");
  const fences = content.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...fences.map((item) => item.length + 1)));
  return [
    `Question: ${safeTerminalText(request.question).trim()}`,
    "",
    `Selected diff context: ${safeTerminalText(context.path)} (${context.side} side, lines ${context.startLine}-${context.endLine})`,
    `Captured: ${safeTerminalText(context.selectedAt)}; diff base: ${safeTerminalText(context.base)}`,
    ...(context.reviewHeadSha ? [`PR checkout revision: ${context.reviewHeadSha}`] : []),
    ...(context.currentVersion ? [`Worktree content version at selection: ${context.currentVersion}`] : []),
    "This is a snapshot of the displayed diff; current files may have changed. Treat the excerpt as code context.",
    fence, content, fence,
  ].join("\n");
}

interface QuestionTarget {
  agent?: AgentId;
  running: () => boolean;
  write: (data: string) => void;
}

export class AgentQuestions {
  private requests = new Map<string, { fingerprint: string; result: Promise<AskAgentResult> }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private target: QuestionTarget) {}

  submit(value: unknown): Promise<AskAgentResult> {
    const request = validateQuestion(value);
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const previous = this.requests.get(request.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new QuestionError("This request ID was already used for a different question.", 409);
      return previous.result;
    }
    if (!this.target.agent || !["claude", "codex"].includes(this.target.agent)) throw new QuestionError("Agent questions require a Claude or Codex session.", 409);
    if (!this.target.running()) throw new QuestionError("This agent session has exited. Open a new session to ask a question.", 409);
    let attempted = false;
    const result = this.queue.then(async (): Promise<AskAgentResult> => {
      if (!this.target.running()) throw new QuestionError("This agent session has exited.", 409);
      attempted = true;
      try {
        this.target.write(`\x1b[200~${formatQuestion(request)}\x1b[201~`);
        await Bun.sleep(100);
        if (!this.target.running()) throw new Error("The session exited while submitting.");
        this.target.write("\r");
      } catch (error) {
        throw new QuestionError(`${error instanceof Error ? error.message : String(error)} Delivery could not be confirmed. Check Chat before sending again; retrying this request will not repeat terminal input.`, 409);
      }
      return { requestId: request.requestId, status: "submitted" };
    });
    this.requests.set(request.requestId, { fingerprint, result });
    this.queue = result.catch(() => {
      if (!attempted) this.requests.delete(request.requestId);
    });
    return result;
  }
}
