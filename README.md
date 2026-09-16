# Agent Manager

## The Vision — July 22, 2026

In June of 2026, I started looking around for nice tools to assist my agentic workflows. After searching for a while, I ended up spending quite a bit of time using [Conductor.build](https://conductor.build). However, as most people inevitably experience when using something built by someone else for many hours every day, there were slight things about the app that just didn't fit my personal preference. So, I decided to commit to building a tool myself.

The fun part is that after the initial building blocks were in place, I can entirely use my own tool to build my own tool, which is what I'm looking forward to the most.

If you try it out, I hope you enjoy.

## Using the app

Agent Manager runs coding agents in separate sessions and lets you inspect their changes, ask questions about code, and review branches or GitHub pull requests.

### Launch the app

For the macOS desktop app, have Git, Bun, and the Rust toolchain (`cargo`) available, along with the Claude or Codex CLI you want to use. Set up authentication for your chosen agent before launching. From the repository root, run:

```sh
bun run setup
```

This installs dependencies, builds the frontend, and launches the desktop app with its local server. The first launch also compiles the native shell. Keep the launching terminal running while using the app.

To use the browser interface instead:

```sh
bun install
bun run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

### Open a project and start working

1. In **Sessions**, choose **Claude** or **Codex** from **Agent**. For Codex, you can choose a model and reasoning effort, or leave **Use Codex settings** selected.
2. Click **New project** and select your project folder. In the browser, enter its path and click **Open**. This opens the project and starts its first session.
3. Type your task in **Chat**, which contains the coding agent's interactive terminal.
4. Click **+** beside a project to start another session. Select a session in the sidebar to switch between tasks. Agent settings apply to newly created sessions.

For Git projects, each session gets a new branch and a separate working directory under `~/agent-manager/workspaces/<repo-name>/<workspace-name>`. Ordinary sessions start from the opened repository's current commit; uncommitted edits in the original folder are not copied. A repository must have at least one commit. For folders without Git, sessions work directly in the same project folder.

### Inspect changes and arrange your workspace

| Panel | How to use it |
| --- | --- |
| **Sessions** | Open projects, create sessions, and switch between them. |
| **Chat** | Give the coding agent instructions and respond to its prompts. |
| **Changes** | Select a changed file to open its diff. Use the shell below the file list to run commands, tests, or Git operations in the session's working directory. |
| **Diff / Source** | Read old and new code side by side. Click **Open source** for the full, read-only file. Use the header's back and forward arrows to retrace code navigation. |
| **Walkthrough** | Generate an explanation of the changes and talk with the dedicated review assistant. |

Drag panel headers to reorder them and drag dividers to resize them. Use the **Panels** bar to hide or restore panels; hiding a terminal keeps its session running. The divider within **Changes** adjusts the space between the file list and shell.

For TypeScript and JavaScript, right-click a symbol in the current source or the new side of a diff to choose **Go to definition** or **Find references**. Command-click also opens definitions. The source viewer supports **F12** for definitions and **Shift+F12** for references.

### Review a branch without a pull request

1. Click **Diff** beside a Git project.
2. Choose **Branch to review** and **Base branch**. For example, compare `feature/my-change` against `main`. Both dropdowns list local and already-fetched remote branches; **Other ref or commit…** lets you enter a tag, commit, or another Git ref.
3. Click **Review diff**. The app opens a new session at the selected head and shows changes since its common ancestor with the base.

The starting revisions are fixed when you open the review. Opening a review does not fetch remote updates or copy uncommitted edits from another workspace. Commit changes you want to review first, and fetch remote branches beforehand if needed. Open a new review to compare newer revisions.

Branch reviews support walkthroughs, questions, and edit requests. GitHub comments, review submission, and PR synchronization are hidden, and GitHub authentication is not required. Requested edits happen in the new review workspace.

### Ask about code or request an edit

Click a line number in a diff, or drag across line numbers on one side, to select code. Write your question and click **Ask agent**. The selection and question go to a dedicated review assistant; its response appears in **Walkthrough**. You can also ask directly in that panel without selecting code.

**Ask** explains code without editing it. To authorize edits in the session's workspace, choose **Request change** in the selected-code composer or use the **Request change** button in the review conversation. This conversation is separate from the coding agent in **Chat**. If no review agent is configured, choose one in **Walkthrough** and click **Use for review**.

For a guided review, click **Start walkthrough** in **Changes** or **Generate walkthrough** in **Walkthrough**. Follow the steps and their code references, use **Mark reviewed & next** to record progress, and mark steps **Revisit** when you want to return later. Check **Outside this walkthrough** and **Analysis limitations** for anything the tour did not cover. If code changes make the tour outdated, click **Regenerate walkthrough**.

### Review a GitHub pull request

1. Have the GitHub CLI (`gh`) installed and authenticated with access to the repository.
2. Click **PR** beside the project. Select an open pull request, or enter its number or URL and press Enter.
3. Inspect its changes and use the same walkthrough and review-assistant tools available for branch diffs.
4. To leave a GitHub comment, select diff lines, change **Destination** to **GitHub comment**, and click **Add to review**. This saves a local draft.
5. Open **Review** at the bottom of the Diff panel, add an optional summary, choose **Comment**, **Approve**, or **Request changes**, and click **Submit review** to publish the review and its drafted comments to GitHub.

The GitHub **Request changes** verdict submits review feedback; the assistant's **Request change** action allows local edits. Existing GitHub threads also have a **Reply** action that posts a reply directly.

If the PR advances on GitHub, the app shows an **Update to PR head** banner. Updating requires no local uncommitted changes or commits beyond the reviewed head. **Submit anyway** publishes comments against the older head you reviewed. Local edits that no longer match the PR disable GitHub comments on affected files.

### Finish a session

Clicking **×** beside a session stops its agents and terminals. For Git sessions, it also removes the workspace, including uncommitted and untracked files, so commit any work you want to keep first. Committed work remains on the session's branch. Sessions in folders without Git leave the project files in place. Clicking **×** beside a project closes all of its sessions.

Sessions, review conversations, and walkthroughs are not restored after a server restart. Existing workspace files remain on disk, but the app does not automatically reconnect them as sessions.
