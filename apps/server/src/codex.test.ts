import { afterAll, expect, test } from "bun:test";
import { CodexModelCatalog, discoverCodexModels } from "./codex";
import { fakeCodex, testModel } from "./testCodex";
import { removeTempDirs } from "./testRepo";

afterAll(removeTempDirs);

function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("model discovery initializes, paginates fragmented responses, and exits its subprocess", async () => {
  const fake = fakeCodex("fragmented");
  expect(await discoverCodexModels(fake.path)).toEqual([testModel]);
  expect(fake.requests().map((request) => request.method)).toEqual(["initialize", "initialized", "model/list", "model/list"]);
  expect(fake.requests().at(-1)?.params?.cursor).toBe("page-two");
  expect(fake.launches()).toEqual([]);
  expect(isAlive(fake.pid())).toBe(false);
});

test("CLI errors, malformed output, and timeouts terminate discovery", async () => {
  for (const mode of ["error", "malformed", "hang"] as const) {
    const fake = fakeCodex(mode);
    await expect(discoverCodexModels(fake.path, 200)).rejects.toThrow();
    expect(isAlive(fake.pid())).toBe(false);
  }
});

test("successful catalogs are cached, expire, refresh, and share concurrent requests", async () => {
  const fake = fakeCodex();
  let now = 0;
  const catalog = new CodexModelCatalog(() => fake.path, discoverCodexModels, () => now);
  const first = await Promise.all([catalog.get(), catalog.get(true), catalog.get()]);
  expect(first.every((result) => result.models[0]?.model === testModel.model)).toBe(true);
  const starts = () => fake.requests().filter((request) => request.method === "initialize").length;
  expect(starts()).toBe(1);
  await catalog.get();
  expect(starts()).toBe(1);
  await catalog.get(true);
  expect(starts()).toBe(2);
  now += 5 * 60_000;
  await catalog.get();
  expect(starts()).toBe(3);
});

test("absence and discovery failure remain distinguishable and failures can be retried", async () => {
  const missing = new CodexModelCatalog(() => null);
  expect(await missing.get()).toMatchObject({ installed: false, models: [], error: expect.stringContaining("PATH") });
  const fake = fakeCodex("error");
  const catalog = new CodexModelCatalog(() => fake.path);
  expect(await catalog.get()).toMatchObject({ installed: true, models: [], error: expect.stringContaining("Update Codex CLI") });
  await catalog.get();
  expect(fake.requests().filter((request) => request.method === "initialize")).toHaveLength(2);
});
