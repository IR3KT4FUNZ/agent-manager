# AGENTS.md

This file is the shared knowledge base for all coding agents working in this repository. Regardless of which task you are working on, read this file first: it records the decisions, conventions, and constraints that apply across the whole codebase, so that every agent works from the same assumptions without having to rediscover them. When you make a decision that future agents need to know about — a new convention, a structural change, a gotcha worth remembering — record it here. Keep entries concise and current; delete anything that no longer holds.

## Rules

### Comments

Write code that is so self-documenting it does not need comments: clear names, small functions, and obvious control flow instead of prose explaining unclear code. Do not write comments by default — only add them when the prompter asks for them or judges one necessary.

### Pull Requests

Every PR is scoped to a single feature or change. Keep them simple enough that the description is usually 2–3 short bullet points, and those bullets completely convey the goal of the PR to reviewers. If a PR needs more than that to explain, it is doing too much — split it.

## Tech Stack

This is a TypeScript monorepo managed with **Bun workspaces** (no Turborepo/Nx).

### Backend

- **Bun** — runtime for the server; also handles PTY management for terminal sessions.
- **Hono** — HTTP framework, running natively on Bun. API clients use `hono/client` (Hono RPC) for end-to-end type safety.
- **WebSockets** — real-time streaming of agent output and session state to the frontend.

### Frontend

- **React 19 + Vite + TypeScript** — web frontend, served by the Bun backend as a static bundle (no desktop shell for now; a Tauri wrapper is a possible later addition).
- **TanStack Query** — server state, combined with WebSocket subscriptions for live data.
- **TanStack Router** — typed routing.
- **Tailwind v4 + shadcn/ui** — styling and UI primitives.
- **xterm.js** — terminal rendering (PTY handling lives on the Bun side).

### Shared

- **`packages/shared`** — types shared between server and frontend.

## Decisions & Gotchas

- **Use `bun-pty`, not `node-pty`.** node-pty's spawn-helper fails under Bun (`posix_spawnp failed`). bun-pty is a Rust/NAPI port with the same API surface (`spawn`, `onData`, `onExit`, `resize`, `kill`).
- Each session (`apps/server/src/sessions.ts`) is one PTY process with an in-memory scrollback buffer (~400 KB) replayed to every new WebSocket subscriber, so reattaching shows history.
- The WS protocol lives in `packages/shared` (`ClientMessage` / `ServerMessage`). Clients should send `ping` every 30 s to stay under Bun's WebSocket idle timeout.
