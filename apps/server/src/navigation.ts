import { realpath, stat } from "node:fs/promises";
import { relative } from "node:path";
import type { NavigationRequest, NavigationResult, SourceLocation } from "@agent-manager/shared";
import { isWithin, positionOffset, readSource, sourcePath, SourceError } from "./source";
import { TsServer } from "./tsServer";

async function fileStamp(path: string): Promise<string | null> {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch {
    return null;
  }
}

interface FileSpan {
  file: string;
  start: { line: number; offset: number };
  end: { line: number; offset: number };
}

export class CodeNavigation {
  private server?: TsServer;
  private opened = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private idle?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private root: string,
    private createServer = (root: string) => new TsServer(root),
    private idleMs = 300_000,
  ) {}

  navigate(request: NavigationRequest): Promise<NavigationResult> {
    const result = this.queue.then(() => this.query(request));
    this.queue = result.catch(() => {});
    return result;
  }

  private async query(request: NavigationRequest): Promise<NavigationResult> {
    if (this.disposed) throw new Error("Session closed.");
    clearTimeout(this.idle);
    try {
      if (
        !request ||
        !["definition", "references"].includes(request.action) ||
        typeof request.path !== "string"
      ) {
        throw new SourceError("Invalid navigation request.");
      }
      const source = await readSource(this.root, request.path);
      if (source.language === "plaintext")
        throw new SourceError("Code navigation supports TypeScript and JavaScript files.");
      if (source.version !== request.version)
        throw new SourceError("This file changed. Refresh it and select the symbol again.", 409);
      positionOffset(source.content, request.line, request.column);
      const root = await realpath(this.root);
      const file = await sourcePath(root, request.path);
      if (this.disposed) throw new Error("Session closed.");
      if (!this.server?.alive) {
        this.server = this.createServer(root);
        this.opened.clear();
        await this.server.request("configure", { hostInfo: "agent-manager" });
        await this.server.request("compilerOptionsForInferredProjects", {
          options: {
            allowJs: true,
            allowNonTsExtensions: true,
            jsx: "react-jsx",
            module: "esnext",
            moduleResolution: "bundler",
          },
          projectRootPath: root,
        });
      }
      const server = this.server;
      const paths = new Set([...this.opened.keys(), request.path]);
      const openVersions = new Map<string, string>();
      for (const path of paths) {
        const previous = this.opened.get(path);
        if (previous) await server.request("close", { file: previous });
        this.opened.delete(path);
        let document;
        try {
          document = await readSource(root, path);
        } catch {
          continue;
        }
        const absolute = await sourcePath(root, path);
        await server.request("open", {
          file: absolute,
          fileContent: document.content,
          projectRootPath: root,
        });
        this.opened.set(path, absolute);
        openVersions.set(absolute, document.version);
      }
      const project = await server.request<{ fileNames?: string[] }>("projectInfo", {
        file,
        needFileNameList: true,
      });
      const stamps = new Map(
        await Promise.all(
          (project.fileNames ?? [])
            .filter((path) => isWithin(root, path))
            .map(async (path) => [path, await fileStamp(path)] as const),
        ),
      );
      await server.request("reloadProjects");
      const args = { file, line: request.line, offset: request.column };
      const response =
        request.action === "definition"
          ? await server.request<FileSpan[] | undefined>("definition", args)
          : (await server.request<{ refs: FileSpan[] } | undefined>("references", args))?.refs;
      if ((await readSource(root, request.path)).version !== source.version) {
        throw new SourceError("This file changed. Refresh it and select the symbol again.", 409);
      }
      const locations: SourceLocation[] = [];
      let excluded = 0;
      const seen = new Set<string>();
      for (const span of response ?? []) {
        if (!isWithin(root, span.file)) {
          excluded++;
          continue;
        }
        const path = relative(root, span.file);
        const key = `${path}:${span.start.line}:${span.start.offset}:${span.end.line}:${span.end.offset}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const target = await readSource(root, path);
          if (
            !stamps.has(span.file) ||
            stamps.get(span.file) !== (await fileStamp(span.file)) ||
            (openVersions.has(span.file) && openVersions.get(span.file) !== target.version)
          ) {
            throw new SourceError("Code changed during navigation. Select the symbol again.", 409);
          }
          locations.push({
            path,
            version: target.version,
            line: span.start.line,
            column: span.start.offset,
            endLine: span.end.line,
            endColumn: span.end.offset,
            preview: target.content.split("\n")[span.start.line - 1]?.trim() ?? "",
          });
        } catch (error) {
          if (error instanceof SourceError && error.status === 409) throw error;
          excluded++;
        }
      }
      locations.sort(
        (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column,
      );
      return {
        locations,
        message: excluded
          ? "Some targets are outside this session or cannot be viewed."
          : undefined,
      };
    } finally {
      if (!this.disposed) this.idle = setTimeout(() => this.stop(), this.idleMs);
    }
  }

  private stop(): void {
    this.server?.dispose();
    this.server = undefined;
    this.opened.clear();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.idle);
    this.stop();
  }
}
