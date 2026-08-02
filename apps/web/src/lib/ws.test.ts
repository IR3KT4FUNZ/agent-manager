import { describe, expect, test } from "bun:test";
import { sessionWsPath, terminalWsPath, wsUrl } from "./ws";

describe("ws url builders", () => {
  test("session path targets the agent pty", () => {
    expect(sessionWsPath("abc")).toBe("/ws/sessions/abc");
  });

  test("terminal path targets the shell pty", () => {
    expect(terminalWsPath("abc")).toBe("/ws/sessions/abc/terminal");
  });

  test("wsUrl joins the base and the path", () => {
    expect(wsUrl("ws://localhost:3001", terminalWsPath("abc"))).toBe(
      "ws://localhost:3001/ws/sessions/abc/terminal",
    );
  });
});
