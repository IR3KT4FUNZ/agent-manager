import { expect, test } from "bun:test";
import type { CreateSessionRequest } from "@agent-manager/shared";
import { resolveAgentLaunch } from "./agents";
import { testModel } from "./testCodex";

const dependencies = {
  findCommand: (command: string) => `/bin/${command}`,
  catalog: async () => ({ installed: true, models: [testModel] }),
};
const resolve = (selection: Omit<CreateSessionRequest, "projectId"> = {}) =>
  resolveAgentLaunch({ projectId: "project", ...selection }, "/tmp", dependencies);

test("default Claude and legacy commands preserve their launch arguments", async () => {
  expect(await resolve()).toEqual({ agent: "claude", command: "claude", executable: "/bin/claude", args: [] });
  expect(await resolve({ command: "cat", args: ["a file", "$(literal)"] })).toEqual({
    command: "cat", args: ["a file", "$(literal)"],
  });
  expect(await resolve({ command: "./tools/agent" })).toEqual({ command: "./tools/agent", args: [] });
  expect(await resolve({ args: ["--continue"] })).toMatchObject({ agent: "claude", args: ["--continue"] });
});

test("Codex defaults need no catalog or model overrides", async () => {
  const launch = await resolveAgentLaunch({ projectId: "p", agent: "codex" }, "/tmp", {
    ...dependencies,
    catalog: async () => { throw new Error("should not discover"); },
  });
  expect(launch).toEqual({ agent: "codex", command: "codex", executable: "/bin/codex", args: ["--no-alt-screen"] });
});

test("explicit Codex models use catalog defaults or the requested supported effort", async () => {
  const launch = await resolve({ agent: "codex", model: testModel.model });
  expect(launch).toMatchObject({ model: "test-model", reasoningEffort: "medium" });
  expect(launch.args).toEqual(["--no-alt-screen", "--model", "test-model", "-c", 'model_reasoning_effort="medium"']);
  expect((await resolve({ agent: "codex", model: testModel.model, reasoningEffort: "high" })).reasoningEffort).toBe("high");
});

test("conflicting options and unsupported models or efforts are rejected", async () => {
  for (const selection of [
    { agent: "codex", command: "cat" },
    { agent: "claude", args: [] },
    { model: "test-model", command: "codex" },
    { agent: "claude", model: "test-model" },
    { agent: "codex", reasoningEffort: "high" },
    { agent: "codex", model: "missing" },
    { agent: "codex", model: "test-model", reasoningEffort: "ultra" },
    { agent: "codex", model: 123 },
    { agent: "other" },
  ]) {
    await expect(resolve(selection as Omit<CreateSessionRequest, "projectId">)).rejects.toThrow();
  }
});

test("missing executables and failed discovery produce actionable errors", async () => {
  await expect(resolveAgentLaunch({ projectId: "p", agent: "codex" }, "/tmp", {
    ...dependencies, findCommand: () => null,
  })).rejects.toThrow(/not found/);
  await expect(resolveAgentLaunch({ projectId: "p", agent: "codex", model: "test-model" }, "/tmp", {
    ...dependencies, catalog: async () => ({ installed: true, models: [], error: "Update Codex CLI" }),
  })).rejects.toThrow("Update Codex CLI");
});
