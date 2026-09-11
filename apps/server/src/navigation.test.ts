import { afterEach, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NavigationRequest } from "@agent-manager/shared";
import { CodeNavigation } from "./navigation";
import { contentVersion, positionOffset, readSource } from "./source";
import { commitAll, removeTempDirs, tempDir, tempRepo } from "./testRepo";
import { getFileDiff } from "./changes";
import { TsMessageDecoder, TsServer } from "./tsServer";

const services: CodeNavigation[] = [];
afterEach(() => {
  services.splice(0).forEach((service) => service.dispose());
  removeTempDirs();
});

function navigation(root: string) {
  const service = new CodeNavigation(root);
  services.push(service);
  return service;
}

async function request(
  root: string,
  path: string,
  symbol: string,
  action: NavigationRequest["action"] = "definition",
): Promise<NavigationRequest> {
  const source = await readSource(root, path);
  const position = source.content.lastIndexOf(symbol);
  const before = source.content.slice(0, position).split("\n");
  return {
    action,
    path,
    line: before.length,
    column: before.at(-1)!.length + 1,
    version: source.version,
  };
}

test("source positions use one-based UTF-16 columns including CRLF and astral characters", () => {
  expect(positionOffset("😀name\r\nsecond", 1, 3)).toBe(2);
  expect(positionOffset("😀name\r\nsecond", 2, 2)).toBe(9);
  expect(() => positionOffset("a", 1, 3)).toThrow("Invalid source position");
  expect(() => positionOffset("a", 0, 1)).toThrow("Invalid source position");
});

test("source reads reject escapes, external symlinks, binary, oversized and missing files", async () => {
  const root = tempDir("navigation-source-");
  const outside = tempDir("navigation-outside-");
  writeFileSync(join(outside, "secret.ts"), "secret");
  symlinkSync(join(outside, "secret.ts"), join(root, "link.ts"));
  writeFileSync(join(root, "binary.ts"), Buffer.from([0, 1]));
  writeFileSync(join(root, "huge.ts"), "a".repeat(1024 * 1024 + 1));
  for (const path of [
    "../secret.ts",
    join(outside, "secret.ts"),
    "link.ts",
    "binary.ts",
    "huge.ts",
    "missing.ts",
  ]) {
    await expect(readSource(root, path)).rejects.toThrow();
  }
  writeFileSync(join(root, "hello.ts"), "hello\n");
  symlinkSync(join(root, "hello.ts"), join(root, "alias.ts"));
  expect(await readSource(root, "alias.ts")).toMatchObject({
    content: "hello\n",
    version: contentVersion("hello\n"),
    language: "typescript",
  });
});

test("real tsserver follows imports, path aliases, re-exports and JSX; references distinguish local names", async () => {
  const root = await tempRepo();
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
        jsx: "react-jsx",
      },
    }),
  );
  writeFileSync(join(root, "src/impl.ts"), "export function Widget() { return null; }\n");
  writeFileSync(join(root, "src/index.ts"), "export { Widget } from './impl';\n");
  writeFileSync(join(root, "src/other.ts"), "function Widget() { return 123; }\nWidget();\n");
  writeFileSync(
    join(root, "src/app.tsx"),
    "import { Widget } from '@/index';\nexport const app = <Widget />;\n",
  );
  const service = navigation(root);
  const definition = await service.navigate(await request(root, "src/app.tsx", "Widget"));
  expect(definition.locations).toMatchObject([{ path: "src/impl.ts", line: 1, column: 17 }]);
  const references = await service.navigate(
    await request(root, "src/impl.ts", "Widget", "references"),
  );
  expect(new Set(references.locations.map((item) => item.path))).toEqual(
    new Set(["src/impl.ts", "src/index.ts", "src/app.tsx"]),
  );
}, 20_000);

test("loose JavaScript navigation refreshes agent edits and rejects old source versions", async () => {
  const root = await tempRepo();
  writeFileSync(join(root, "value.js"), "export function value() { return 1; }\n");
  writeFileSync(join(root, "use.jsx"), "import { value } from './value';\nvalue();\n");
  const service = navigation(root);
  const query = await request(root, "use.jsx", "value");
  expect((await service.navigate(query)).locations[0]?.line).toBe(1);
  writeFileSync(join(root, "value.js"), "\n\nexport function value() { return 2; }\n");
  expect((await service.navigate(query)).locations[0]?.line).toBe(3);
  writeFileSync(join(root, "use.jsx"), "\nimport { value } from './value';\nvalue();\n");
  await expect(service.navigate(query)).rejects.toThrow("This file changed");
  expect((await service.navigate(await request(root, "use.jsx", "value"))).locations[0]?.line).toBe(
    3,
  );
}, 20_000);

test("diff version identifies the current file and navigation remains isolated between sessions", async () => {
  const first = await tempRepo();
  const second = await tempRepo();
  for (const [root, content] of [
    [first, "export const value = 1;\n"],
    [second, "\nexport const value = 2;\n"],
  ]) {
    writeFileSync(join(root!, "value.ts"), content!);
    await commitAll(root!, "value");
    writeFileSync(join(root!, "use.ts"), "import { value } from './value';\nvalue;\n");
  }
  const diff = await getFileDiff({ path: first, repoRoot: first, branch: "main" }, "use.ts");
  expect(diff.currentVersion).toBe((await readSource(first, "use.ts")).version);
  const locations = await Promise.all(
    [first, second].map(
      async (root) =>
        (await navigation(root).navigate(await request(root, "use.ts", "value"))).locations,
    ),
  );
  expect(locations.map((items) => items[0]?.line)).toEqual([1, 2]);
}, 20_000);

test("external definitions are explained and unsupported source never starts the language server", async () => {
  const root = tempDir("navigation-root-");
  const outside = tempDir("navigation-external-");
  writeFileSync(join(outside, "external.ts"), "export const value = 1;");
  writeFileSync(
    join(root, "use.ts"),
    `import { value } from '${join(outside, "external")}';\nvalue;`,
  );
  expect(await navigation(root).navigate(await request(root, "use.ts", "value"))).toMatchObject({
    locations: [],
    message: expect.stringContaining("outside this session"),
  });
  let starts = 0;
  const service = new CodeNavigation(root, () => {
    starts++;
    throw new Error("unexpected start");
  });
  services.push(service);
  writeFileSync(join(root, "text.txt"), "value");
  await expect(service.navigate(await request(root, "text.txt", "value"))).rejects.toThrow(
    "TypeScript and JavaScript",
  );
  expect(starts).toBe(0);
}, 20_000);

test("protocol decoder handles fragmented multibyte responses and adjacent events", () => {
  const messages = [
    { type: "event", body: "😀" },
    { type: "response", request_seq: 7, success: true },
  ];
  const bytes = Buffer.concat(
    messages.map((message) => {
      const body = JSON.stringify(message);
      return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\n`);
    }),
  );
  const decoder = new TsMessageDecoder();
  const decoded = [...bytes].flatMap((byte) => decoder.push(new Uint8Array([byte])));
  expect(decoded).toEqual(messages);
  expect(() =>
    new TsMessageDecoder().push(Buffer.from("Content-Length: 999999999\r\n\r\n")),
  ).toThrow("too large");
});

test("language server multiplexes requests and terminates after timeout or disposal", async () => {
  const root = tempDir("navigation-protocol-");
  const server = new TsServer(root);
  try {
    await Promise.all([
      server.request("configure", { hostInfo: "first" }),
      server.request("configure", { hostInfo: "second" }),
    ]);
    expect(server.alive).toBe(true);
  } finally {
    server.dispose();
    await server.completion;
  }
  expect(server.alive).toBe(false);
  const hung = new TsServer(root, 50, [process.execPath, "-e", "setInterval(() => {}, 1000)"]);
  await expect(hung.request("configure")).rejects.toThrow("timed out");
  await hung.completion;
  expect(hung.alive).toBe(false);
});

test("idle servers and crashed servers are recreated on demand; disposal prevents new requests", async () => {
  const root = tempDir("navigation-lifecycle-");
  writeFileSync(join(root, "code.ts"), "const value = 1;\nvalue;");
  const started: TsServer[] = [];
  const service = new CodeNavigation(
    root,
    (cwd) => {
      const server = new TsServer(cwd);
      started.push(server);
      return server;
    },
    30,
  );
  services.push(service);
  const query = await request(root, "code.ts", "value");
  await service.navigate(query);
  await Bun.sleep(60);
  expect(started[0]?.alive).toBe(false);
  await service.navigate(query);
  started[1]!.dispose();
  await service.navigate(query);
  expect(started).toHaveLength(3);
  service.dispose();
  expect(started[2]?.alive).toBe(false);
  await expect(service.navigate(query)).rejects.toThrow("Session closed");
}, 20_000);

test("a target edited while definitions resolve cannot receive an incorrect version stamp", async () => {
  const root = await tempRepo();
  writeFileSync(join(root, "value.ts"), "export const value = 1;\n");
  writeFileSync(join(root, "use.ts"), "import { value } from './value';\nvalue;");
  const service = new CodeNavigation(root, (cwd) => {
    const server = new TsServer(cwd);
    const send = server.request.bind(server);
    server.request = async <T>(command: string, args: unknown) => {
      const result = await send<T>(command, args);
      if (command === "definition")
        writeFileSync(join(root, "value.ts"), "\nexport const value = 2;\n");
      return result;
    };
    return server;
  });
  services.push(service);
  await expect(service.navigate(await request(root, "use.ts", "value"))).rejects.toThrow(
    "Code changed during navigation",
  );
}, 20_000);
