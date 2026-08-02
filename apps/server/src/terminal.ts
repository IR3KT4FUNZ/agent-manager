import { spawn } from "bun-pty";
import type { ServerMessage } from "@agent-manager/shared";
import { trimScrollback } from "./scrollback";

type Subscriber = (message: ServerMessage) => void;

export function resolveShell(env: Record<string, string | undefined> = process.env): {
  command: string;
  args: string[];
} {
  return { command: env.SHELL ?? "/bin/zsh", args: ["-l"] };
}

export class ShellTerminal {
  status: "running" | "exited" = "running";
  exitCode: number | null = null;

  private scrollback = "";
  private subscribers = new Set<Subscriber>();
  private pty: ReturnType<typeof spawn>;

  constructor(cwd: string) {
    const { command, args } = resolveShell();
    this.pty = spawn(command, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    });

    this.pty.onData((data: string) => {
      this.scrollback = trimScrollback(this.scrollback, data);
      this.broadcast({ type: "output", data });
    });

    this.pty.onExit(({ exitCode }: { exitCode: number }) => {
      this.status = "exited";
      this.exitCode = exitCode;
      this.broadcast({ type: "exit", exitCode });
    });
  }

  attach(subscriber: Subscriber): () => void {
    if (this.scrollback) subscriber({ type: "output", data: this.scrollback });
    if (this.status === "exited") subscriber({ type: "exit", exitCode: this.exitCode ?? 0 });
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  write(data: string) {
    if (this.status === "running") this.pty.write(data);
  }

  resize(cols: number, rows: number) {
    if (this.status === "running" && cols > 0 && rows > 0) this.pty.resize(cols, rows);
  }

  dispose() {
    if (this.status === "running") this.pty.kill();
  }

  private broadcast(message: ServerMessage) {
    for (const subscriber of this.subscribers) subscriber(message);
  }
}
