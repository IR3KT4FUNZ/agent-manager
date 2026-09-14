import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSelection, ReviewMode } from "@agent-manager/shared";

export interface ProviderRequest {
  cwd: string;
  selection: AgentSelection;
  conversationId?: string;
  mode: ReviewMode;
  prompt: string;
  schema: object;
  signal: AbortSignal;
}
export interface ProviderResult {
  conversationId: string;
  value: unknown;
}
export type ReviewProvider = (
  request: ProviderRequest,
) => Promise<ProviderResult>;

export function providerArgs(
  request: ProviderRequest,
  schemaPath: string,
): string[] {
  const { selection, conversationId, mode } = request;
  if (selection.agent === "codex") {
    const args = [
      "exec",
      ...(conversationId ? ["resume", conversationId] : []),
      "--json",
      "--output-schema",
      schemaPath,
      "--ignore-user-config",
      "--ignore-rules",
      "-c",
      'approval_policy="never"',
      "-c",
      `sandbox_mode="${mode === "change" ? "workspace-write" : "read-only"}"`,
      "-c",
      "sandbox_workspace_write.network_access=false",
    ];
    if (selection.model) args.push("--model", selection.model);
    if (selection.reasoningEffort)
      args.push(
        "-c",
        `model_reasoning_effort=${JSON.stringify(selection.reasoningEffort)}`,
      );
    return [...args, "-"];
  }
  const allowed =
    mode === "change" ? "Read,Glob,Grep,Edit,Write" : "Read,Glob,Grep";
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(request.schema),
    "--tools",
    allowed,
    "--allowedTools",
    allowed,
    "--permission-mode",
    mode === "change" ? "acceptEdits" : "dontAsk",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    ...(selection.model ? ["--model", selection.model] : []),
    ...(conversationId ? ["--resume", conversationId] : []),
  ];
}

export function parseProviderOutput(
  agent: AgentSelection["agent"],
  output: string,
  previousId?: string,
): ProviderResult {
  if (agent === "claude") {
    const result = JSON.parse(output);
    if (result.is_error)
      throw new Error(
        result.result || "Claude could not complete the review request.",
      );
    if (!result.session_id || result.structured_output === undefined)
      throw new Error(
        "Claude returned no structured review result. Update the CLI and retry.",
      );
    return {
      conversationId: result.session_id,
      value: result.structured_output,
    };
  }
  let conversationId = previousId;
  let message: string | undefined;
  for (const line of output.split("\n").filter((line) => line.trim())) {
    const event = JSON.parse(line);
    if (event.type === "thread.started") conversationId = event.thread_id;
    if (event.type === "error" || event.type === "turn.failed")
      throw new Error(
        event.message ?? event.error?.message ?? "Codex review failed.",
      );
    if (event.type === "item.completed" && event.item?.type === "agent_message")
      message = event.item.text;
  }
  if (!conversationId || !message)
    throw new Error(
      "Codex returned no structured review result. Update the CLI and retry.",
    );
  return { conversationId, value: JSON.parse(message) };
}

export function createReviewProvider(
  findBinary = (agent: string) => Bun.which(agent),
  timeoutMs = 300_000,
): ReviewProvider {
  return async (request) => {
    request.signal.throwIfAborted();
    const binary = findBinary(request.selection.agent!);
    if (!binary)
      throw new Error(
        `Install ${request.selection.agent} and sign in before using the review assistant.`,
      );
    const directory = await mkdtemp(join(tmpdir(), "agent-manager-review-"));
    try {
      const schemaPath = join(directory, "schema.json");
      await writeFile(schemaPath, JSON.stringify(request.schema));
      const child = Bun.spawn([binary, ...providerArgs(request, schemaPath)], {
        cwd: request.cwd,
        detached: true,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CLAUDECODE: undefined, FORCE_COLOR: "0" },
      });
      let force: ReturnType<typeof setTimeout> | undefined;
      const killGroup = (signal: NodeJS.Signals) => {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      const stop = () => {
        clearTimeout(force);
        killGroup("SIGTERM");
        force = setTimeout(() => killGroup("SIGKILL"), 500);
      };
      let timeout = false;
      const timer = setTimeout(() => {
        timeout = true;
        stop();
      }, timeoutMs);
      request.signal.addEventListener("abort", stop, { once: true });
      if (request.signal.aborted) stop();
      let overflow = false;
      const read = async (
        stream: ReadableStream<Uint8Array>,
        limit: number,
      ) => {
        let output = "";
        let size = 0;
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > limit) {
            overflow = true;
            stop();
            break;
          }
          output += decoder.decode(chunk, { stream: true });
        }
        return output + decoder.decode();
      };
      try {
        const streams = Promise.all([
          read(child.stdout, 4 * 1024 * 1024),
          read(child.stderr, 64 * 1024),
        ]);
        child.stdin.write(request.prompt);
        await child.stdin.flush();
        child.stdin.end();
        const [stdout, stderr] = await streams;
        const code = await child.exited;
        request.signal.throwIfAborted();
        if (timeout)
          throw new Error(
            "Review request exceeded five minutes. Retry with a smaller scope.",
          );
        if (overflow)
          throw new Error("Review agent output exceeded its size limit.");
        if (code !== 0)
          throw new Error(
            stderr.trim().slice(-2000) ||
              `Review agent exited with code ${code}. Check the CLI login and retry.`,
          );
        return parseProviderOutput(
          request.selection.agent,
          stdout,
          request.conversationId,
        );
      } finally {
        clearTimeout(timer);
        clearTimeout(force);
        request.signal.removeEventListener("abort", stop);
        if (
          request.signal.aborted ||
          timeout ||
          overflow ||
          child.exitCode === null
        ) {
          killGroup("SIGKILL");
          await child.exited;
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
