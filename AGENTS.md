# AGENTS.md

This file is the shared knowledge base for all coding agents working in this repository. Regardless of which task you are working on, read this file first: it records the decisions, conventions, and constraints that apply across the whole codebase, so that every agent works from the same assumptions without having to rediscover them. When you make a decision that future agents need to know about — a new convention, a structural change, a gotcha worth remembering — record it here. Keep entries concise and current; delete anything that no longer holds.

## Rules

### Comments

Write code that is so self-documenting it does not need comments: clear names, small functions, and obvious control flow instead of prose explaining unclear code. Do not write comments by default — only add them when the prompter asks for them or judges one necessary.

### Testing

Testing matters: features should be rigorously covered by both unit tests and integration tests. But the quality of the test suite matters just as much as its existence. Avoid redundant tests and bloated tests. Each test should target a specific portion of code with clear intent, and it should be simpler than the code it exercises — if a test is harder to follow than what it verifies, rethink it.

### Pull Requests

Every PR is scoped to a single feature or change. Keep them simple enough that the description is usually 2–3 short bullet points, and those bullets completely convey the goal of the PR to reviewers. If a PR needs more than that to explain, it is doing too much — split it.

Agents never merge PRs. Open the PR, report it, and stop — a human reviews and merges.

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

### Desktop

- **Tauri v2** (`apps/desktop`) — macOS native shell wrapping the web frontend. `bun run --cwd apps/desktop dev` boots the server, Vite, and the native window together; `scripts/setup.sh --desktop` builds the `.app` bundle.

### Shared

- **`packages/shared`** — types shared between server and frontend.

## Decisions & Gotchas

- **Use `bun-pty`, not `node-pty`.** node-pty's spawn-helper fails under Bun (`posix_spawnp failed`). bun-pty is a Rust/NAPI port with the same API surface (`spawn`, `onData`, `onExit`, `resize`, `kill`).
- Each session (`apps/server/src/sessions.ts`) is one PTY process with an in-memory scrollback buffer (~400 KB) replayed to every new WebSocket subscriber, so reattaching shows history.
- The WS protocol lives in `packages/shared` (`ClientMessage` / `ServerMessage`). Clients should send `ping` every 30 s to stay under Bun's WebSocket idle timeout.
- **Never proxy WebSockets through Vite.** Vite runs under Bun (`bun run` shims `node` to Bun), and Vite's WS proxy calls `net.Socket#destroySoon`, which Bun doesn't implement — the first proxied WS request crashes the dev server. Only `/api` (HTTP) goes through the Vite proxy; the frontend opens WebSockets directly to `ws://localhost:3001` in dev (see `SessionTerminal.tsx`).
- Only `apps/desktop/app-icon.png` is committed; `src-tauri/icons/` is generated from it by `scripts/setup.sh` and gitignored.
- Tauri bundle targets are `["app"]` only — the DMG bundler scripts Finder via AppleScript and fails in non-interactive shells.
- The packaged `.app` does not yet bundle the Bun server as a sidecar; it expects `bun run start` running separately. Dev mode (`tauri dev`) is fully self-contained.
- **Per-session git worktrees** (`apps/server/src/worktrees.ts`): when the folder a session is created in is inside a git repo (with at least one commit), the server automatically `git worktree add`s a dedicated worktree on a fresh branch and runs the session there. If the folder is not a repo, the session runs directly in it (unchanged). All git runs through `runGit` (`Bun.spawn` with an argv array — never a shell string — and `GIT_TERMINAL_PROMPT=0`); these are purely local ops, so no git auth is needed, and the PTY inherits the user's normal git env for any later push.
- Worktrees live at `~/agent-manager/workspaces/<repo-basename>/<workspace-name>` (Conductor-style; keeps the source repo pristine). `<workspace-name>` is a generated `adjective-noun` friendly name, and the branch name matches it.
- **Panels are reorderable via CSS flex `order`, never DOM moves** (`PanelBoard.tsx`): the sessions/changes/chat columns render in fixed DOM order and reorder visually only, because moving the xterm canvas in the DOM risks losing its WebGL context. The order is persisted in `localStorage` (`agent-manager.panel-order`) and shared across routes via `usePanelOrder` (`lib/panelOrder.ts`).
- **Killing a session removes its worktree (`git worktree remove --force`) but never deletes the branch** — committed work on the branch always survives; only uncommitted/untracked changes in the worktree are discarded. Sessions are in-memory, so a server restart orphans on-disk worktrees under the app root; there is no auto-reaping (add a manual `git worktree prune` utility if this becomes a problem).
