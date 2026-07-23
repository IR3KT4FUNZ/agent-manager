# AGENTS.md

This file is the shared knowledge base for all coding agents working in this repository. Regardless of which task you are working on, read this file first: it records the decisions, conventions, and constraints that apply across the whole codebase, so that every agent works from the same assumptions without having to rediscover them. When you make a decision that future agents need to know about — a new convention, a structural change, a gotcha worth remembering — record it here. Keep entries concise and current; delete anything that no longer holds.

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
