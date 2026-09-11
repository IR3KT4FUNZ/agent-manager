import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ClientMessage, ServerMessage } from "@agent-manager/shared";
import { sessionWsPath, terminalWsPath, wsUrl } from "../lib/ws";

const wsBase = import.meta.env.DEV
  ? "ws://localhost:3001"
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

function TerminalPane({ url, autoFocus = true, focusKey = 0 }: { url: string; autoFocus?: boolean; focusKey?: number }) {
  const terminalRef = useRef<Terminal | null>(null);
  const focusPending = useRef(false);
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
    terminalRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try {
      term.loadAddon(new WebglAddon());
    } catch {}
    if (container.clientWidth > 0 && container.clientHeight > 0) fit.fit();

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
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (container.clientWidth === 0 || container.clientHeight === 0) return;
        fit.fit();
        send({ type: "resize", cols: term.cols, rows: term.rows });
        if (focusPending.current) {
          term.focus();
          focusPending.current = false;
        }
      });
    });
    resizeObserver.observe(container);
    const keepalive = setInterval(() => send({ type: "ping" }), 30_000);
    if (autoFocus) term.focus();

    return () => {
      clearInterval(keepalive);
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      input.dispose();
      ws.close();
      terminalRef.current = null;
      term.dispose();
    };
  }, [url, autoFocus]);

  useEffect(() => {
    if (!focusKey) return;
    focusPending.current = true;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const container = containerRef.current;
        if (!container || !container.clientWidth || !container.clientHeight) return;
        terminalRef.current?.focus();
        focusPending.current = false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  return (
    <div className="h-full w-full bg-[#09090b] p-2">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export function SessionTerminal({ sessionId, focusKey }: { sessionId: string; focusKey?: number }) {
  return <TerminalPane focusKey={focusKey} url={wsUrl(wsBase, sessionWsPath(sessionId))} />;
}

export function SessionShellTerminal({ sessionId }: { sessionId: string }) {
  return <TerminalPane url={wsUrl(wsBase, terminalWsPath(sessionId))} autoFocus={false} />;
}
