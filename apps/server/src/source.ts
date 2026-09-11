import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { SourceDocument } from "@agent-manager/shared";

export const MAX_SOURCE_BYTES = 1024 * 1024;

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 = 400,
  ) {
    super(message);
  }
}

export function contentVersion(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function sourcePath(root: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || path.includes("\0"))
    throw new SourceError("Invalid source path.");
  const canonicalRoot = await realpath(root);
  const candidate = resolve(canonicalRoot, path);
  if (!isWithin(canonicalRoot, candidate)) throw new SourceError("Source is outside this session.");
  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch {
    throw new SourceError("Source file no longer exists.", 404);
  }
  if (!isWithin(canonicalRoot, canonical)) throw new SourceError("Source is outside this session.");
  return canonical;
}

export async function readSource(root: string, path: string): Promise<SourceDocument> {
  const canonical = await sourcePath(root, path);
  const file = await open(canonical, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new SourceError("Source path is not a file.");
    if (stat.size > MAX_SOURCE_BYTES)
      throw new SourceError("File too large to view (limit 1 MiB).", 413);
    const bytes = Buffer.alloc(MAX_SOURCE_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const read = await file.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > MAX_SOURCE_BYTES)
      throw new SourceError("File too large to view (limit 1 MiB).", 413);
    const content = bytes.subarray(0, bytesRead);
    if (content.includes(0)) throw new SourceError("Binary files cannot be viewed as source.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      throw new SourceError("This file is not UTF-8 text.");
    }
    return {
      path,
      content: text,
      version: contentVersion(content),
      language: /\.(?:[cm]?ts|tsx)$/i.test(path)
        ? "typescript"
        : /\.(?:[cm]?js|jsx)$/i.test(path)
          ? "javascript"
          : "plaintext",
    };
  } finally {
    await file.close();
  }
}

export function positionOffset(content: string, line: number, column: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
    throw new SourceError("Invalid source position.");
  }
  const lines = content.split("\n");
  const text = lines[line - 1]?.replace(/\r$/, "");
  if (text === undefined || column > text.length + 1)
    throw new SourceError("Invalid source position.");
  return (
    lines.slice(0, line - 1).reduce((offset, value) => offset + value.length + 1, 0) + column - 1
  );
}
