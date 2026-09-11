import type { AgentSelection, CodexCatalog, CreateSessionRequest } from "@agent-manager/shared";
import { codexCatalog } from "./codex";

export interface AgentLaunch extends AgentSelection {
  command: string;
  executable?: string;
  args: string[];
}

interface LaunchDependencies {
  findCommand: (command: string, cwd: string) => string | null;
  catalog: () => Promise<CodexCatalog>;
}

const defaults: LaunchDependencies = {
  findCommand: (command, cwd) => Bun.which(command, { cwd }),
  catalog: () => codexCatalog.get(),
};

export async function resolveAgentLaunch(
  request: CreateSessionRequest,
  cwd: string,
  dependencies = defaults,
): Promise<AgentLaunch> {
  const structured = request.agent !== undefined || request.model !== undefined || request.reasoningEffort !== undefined;
  const raw = request.command !== undefined || request.args !== undefined;
  if (structured && raw) throw new Error("Agent options cannot be combined with command or args.");
  if (request.agent !== undefined && request.agent !== "claude" && request.agent !== "codex") {
    throw new Error("Choose Claude or Codex as the agent.");
  }
  if (request.command !== undefined && (typeof request.command !== "string" || !request.command.trim())) {
    throw new Error("Command must be a non-empty string.");
  }
  if (request.args !== undefined && (!Array.isArray(request.args) || !request.args.every((arg) => typeof arg === "string"))) {
    throw new Error("Args must be an array of strings.");
  }
  const agent = request.agent ?? "claude";
  if (agent !== "codex" && (request.model !== undefined || request.reasoningEffort !== undefined)) {
    throw new Error("Model and reasoning effort can only be selected for Codex.");
  }
  const command = request.command ?? agent;
  const executable = dependencies.findCommand(command, cwd);
  if (!executable) throw new Error(`${command} executable not found. Install it and make sure it is on PATH.`);
  if (raw) return { command, args: request.args ?? [], ...(request.command === undefined ? { agent } : {}) };
  if (agent === "claude") return { agent, command, executable, args: [] };

  const args = ["--no-alt-screen"];
  if (request.model === undefined) {
    if (request.reasoningEffort !== undefined) throw new Error("Choose a Codex model before setting reasoning effort.");
    return { agent, command, executable, args };
  }
  if (typeof request.model !== "string" || !request.model.trim()) throw new Error("Choose a valid Codex model.");
  const catalog = await dependencies.catalog();
  if (catalog.error) throw new Error(catalog.error);
  const model = catalog.models.find((item) => item.model === request.model);
  if (!model) throw new Error(`Codex model '${request.model}' is unavailable. Refresh the model list and select a model.`);
  const reasoningEffort = request.reasoningEffort ?? model.defaultReasoningEffort;
  if (!model.supportedReasoningEfforts.some((item) => item.reasoningEffort === reasoningEffort)) {
    throw new Error(`Reasoning effort '${reasoningEffort}' is not supported by ${model.displayName}.`);
  }
  args.push("--model", model.model, "-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  return { agent, command, executable, args, model: model.model, reasoningEffort };
}
