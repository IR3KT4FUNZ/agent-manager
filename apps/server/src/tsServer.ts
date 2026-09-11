import type { Subprocess } from "bun";

interface ResponseMessage {
  type: string;
  request_seq?: number;
  success?: boolean;
  message?: string;
  body?: unknown;
}

export class TsMessageDecoder {
  private buffer = Buffer.alloc(0);

  push(bytes: Uint8Array): ResponseMessage[] {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > 16 * 1024 * 1024)
      throw new Error("Language server response is too large.");
    const messages: ResponseMessage[] = [];
    while (true) {
      const start = this.buffer.indexOf("Content-Length:");
      if (start < 0) break;
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) break;
      const match = /^Content-Length: (\d+)\r\n\r\n$/.exec(
        this.buffer.subarray(0, end + 4).toString(),
      );
      if (!match) throw new Error("Invalid language server response.");
      const length = Number(match[1]);
      if (length > 16 * 1024 * 1024) throw new Error("Language server response is too large.");
      if (this.buffer.length < end + 4 + length) break;
      messages.push(JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString()));
      this.buffer = this.buffer.subarray(end + 4 + length);
    }
    return messages;
  }
}

export class TsServer {
  private process: Subprocess<"pipe", "pipe", "pipe">;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (body: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private stopped = false;
  readonly completion: Promise<void>;

  constructor(
    root: string,
    private timeoutMs = 15_000,
    command = [
      process.execPath,
      import.meta.resolveSync("typescript/lib/tsserver.js"),
      "--disableAutomaticTypingAcquisition",
      "--useInferredProjectPerProjectRoot",
      "--suppressDiagnosticEvents",
      "--noGetErrOnBackgroundUpdate",
    ],
  ) {
    this.process = Bun.spawn(command, {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TSS_LOG: "" },
    });
    this.completion = this.read();
    void this.process.stderr.pipeTo(new WritableStream({ write() {} })).catch(() => {});
    void this.process.exited.then(() =>
      this.dispose(new Error("Language server stopped. Retry navigation.")),
    );
  }

  get alive(): boolean {
    return !this.stopped;
  }

  request<T>(command: string, args: unknown = {}): Promise<T> {
    if (this.stopped)
      return Promise.reject(new Error("Language server stopped. Retry navigation."));
    const seq = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => this.dispose(new Error("Code navigation timed out. Retry navigation.")),
        this.timeoutMs,
      );
      this.pending.set(seq, {
        resolve: (body) => resolve(body as T),
        reject,
        timer,
      });
      try {
        this.process.stdin.write(
          JSON.stringify({ seq, type: "request", command, arguments: args }) + "\n",
        );
        this.process.stdin.flush();
      } catch (error) {
        this.dispose(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async read(): Promise<void> {
    const decoder = new TsMessageDecoder();
    try {
      for await (const bytes of this.process.stdout) {
        for (const message of decoder.push(bytes)) {
          if (message.type !== "response" || message.request_seq === undefined) continue;
          const pending = this.pending.get(message.request_seq);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.request_seq);
          if (message.success) pending.resolve(message.body);
          else if (message.message === "No content available.") pending.resolve(undefined);
          else pending.reject(new Error(message.message ?? "Code navigation failed."));
        }
      }
    } catch (error) {
      this.dispose(error instanceof Error ? error : new Error(String(error)));
    }
  }

  dispose(error = new Error("Code navigation closed.")): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.process.stdin.end();
    this.process.kill();
    const force = setTimeout(() => this.process.kill("SIGKILL"), 250);
    void this.process.exited.then(() => clearTimeout(force));
  }
}
