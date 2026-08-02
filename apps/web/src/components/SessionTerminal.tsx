import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ClientMessage, ServerMessage } from "@agent-manager/shared";
import { sessionWsPath, terminalWsPath, wsUrl } from "../lib/ws";

const wsBase = import.meta.env.DEV
  ? "ws://localhost:3001"
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

function TerminalPane({ url, autoFocus = true }: { url: string; autoFocus?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      theme: { background: "#09090b", foreground: "#e4e4e7" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      term.loadAddon(new WebglAddon());
    } catch {}
    fit.fit();

    const ws = new WebSocket(url);
    const send = (message: ClientMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    ws.onopen = () => send({ type: "resize", cols: term.cols, rows: term.rows });
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "output") term.write(message.data);
      else if (message.type === "exit")
        term.write(`\r\n\x1b[90m[process exited with code ${message.exitCode}]\x1b[0m\r\n`);
    };

    const input = term.onData((data) => send({ type: "input", data }));
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      send({ type: "resize", cols: term.cols, rows: term.rows });
    });
    resizeObserver.observe(container);
    const keepalive = setInterval(() => send({ type: "ping" }), 30_000);
    if (autoFocus) term.focus();

    return () => {
      clearInterval(keepalive);
      resizeObserver.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
    };
  }, [url, autoFocus]);

  return <div ref={containerRef} className="h-full w-full bg-[#09090b] p-2" />;
}

export function SessionTerminal({ sessionId }: { sessionId: string }) {
  return <TerminalPane url={wsUrl(wsBase, sessionWsPath(sessionId))} />;
}

export function SessionShellTerminal({ sessionId }: { sessionId: string }) {
  return <TerminalPane url={wsUrl(wsBase, terminalWsPath(sessionId))} autoFocus={false} />;
}
