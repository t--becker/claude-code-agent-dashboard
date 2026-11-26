# Reference

How the dashboard works underneath. For getting started, see the [README](../README.md).

## Using it, in detail

- **The page.** Agents waiting for your reply come first, each as a banner with the question, the
  replies on offer and a box for your own. Below is one grid with a card for every open agent,
  running or finished, in the order you arranged them. **Closed sessions** at the bottom holds
  the cards you closed yourself, each ready to reopen.
- **Search.** The box at the top (⌘K, or Ctrl+K) looks through every chat the workspace holds,
  open and closed: titles, project names, your prompts, the replies and the tool steps. Every
  word you type must appear in the title or in one message. Chats matched by title come first,
  then the most recently active. Enter or a click opens the chat in the full view; a closed
  chat is reopened first. It searches what the workspace keeps of each chat, which for a very long one is its most recent 1,500 to 2,000 entries.
- **Chips.** All, Running and Done filter the page and count the open agents; Needs reply joins
  them when an agent is waiting. Done covers finished, stopped and failed.
- **The "…" on a card** holds Open chat, Pin, Rename, Change icon and Close. Double-clicking the
  title also renames; clicking the icon also changes it; the arrows in the message box also open
  the full view; the sliders there show the model and permissions for the next prompt.
- **Topic icon.** Each chat has an icon left of its title, in the chat's own colour, for the kind
  of work it holds. It is suggested from the title and the first prompt (`shared/topics.ts`:
  keywords per topic, the title weighted above the prompt), never from the repo, since unrelated
  chats share one. A chat still named after its folder shows the general icon until its first
  prompt. Click the icon to pick another: your pick is saved with the chat and nothing replaces
  it, and the picker offers the suggestion back. Until you pick, a rename can change the
  suggestion; later prompts do not. The same icon shows on the card, in the full view, on the
  reply banner, in search results and in the Closed sessions list. Topics are line icons from lucide; a picture named after a topic id in `~/.agent-workspace/logos` replaces its icon.
- **Pin.** Pinning a card (from its menu) keeps it at the front of the grid; a pinned card shows
  a pin beside its title, which unpins it.
- **Your picture.** Put a picture at `~/.agent-workspace/avatar.png` (or `.jpg`, `.webp`, `.gif`,
  up to 2 MB) and it shows beside your messages. The server only reads that file; it never
  fetches a picture from the internet. Without one, your messages get a plain person icon.
- **Open chat** (or the arrows in the message box) gives one agent the whole page, with its
  model, permissions and folder. Escape, Shrink or ← All agents goes back.
- **New agent** asks for one thing: the project folder. On macOS it opens the system folder
  chooser, starting in the repos folder; elsewhere, or with `FOLDER_PICKER=off`, it asks for the
  path on the page. The card opens ready for your first prompt, on Claude Code with the default
  model and the workspace's permission mode. Model and permissions can be changed afterwards in
  the card's expanded view.
- **Titles.** A new card is named after its folder until you send the first prompt, which names
  it. Rename any card with the pencil beside its title, or by double-clicking the title: Enter
  saves, Escape cancels. A name you give is never replaced.
- **Order.** Drag a card by its header onto another card to put it there. The order is remembered
  in this browser. A card you have not placed yet (a new agent, a chat just mirrored in) appears
  first.
- **Files.** Paste a file into the prompt box, drop files anywhere on the card, or use the **+** button.
  Any type, up to 10 per prompt, 20 MB each and 50 MB together. PNG, JPEG, GIF and WebP pictures
  up to 5 MB are shown to Claude Code as pictures (larger ones are scaled down first). Every other
  file is saved and Claude Code is given its path, which it opens with its own tools, so what it
  can make of a file is what Claude Code can read: text, code, CSV, PDF, notebooks and the like.
  Files show on your prompt in the transcript, are kept in
  `~/.agent-workspace/attachments/<card id>` and are deleted when you delete the card. Codex is
  given the saved paths for everything.

## How agents run

| Tool        | Integration                                                                 | When it is live                               |
| ----------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| Claude Code | `@anthropic-ai/claude-agent-sdk` (`query()` per prompt, resumed by session) | The `claude` CLI is signed in on this machine |
| Codex       | `codex exec --json`, resumed by thread id                                   | A `codex` binary is on `PATH`                 |

Credentials never leave the server: Claude Code uses the CLI's own login (keychain or
`ANTHROPIC_API_KEY`), Codex uses `~/.codex/auth.json`. The browser only talks to this server.

Model lists are real: Claude Code's come from the SDK's `supportedModels()` (aliases such as
`default`, `opus`, `sonnet` plus dated ids), Codex's from `~/.codex/models_cache.json`.

If a tool is unavailable it runs in **demo mode**: the card is labelled "Demo mode", the
foot of the page says why, and every simulated reply states that nothing was changed on disk.
`FORCE_DEMO=1` puts both tools in demo mode (the e2e suite uses this).

The Codex adapter has not been run against a real `codex` binary yet, so treat it as
experimental. Claude Code is the supported tool.

## Chats that are already running

Chats that a running Claude Code process has open appear in the workspace on their own: the
server reads `~/.claude/sessions/<pid>.json` every few seconds, mirrors each open chat as a
card (transcript loaded, new messages arriving as the chat continues, with the client and
busy/idle status on the card), moves the card to Closed sessions when that process exits, and
brings it back if the same chat is opened again. Deleting such a card keeps it out until the
server restarts. Set `AUTO_MIRROR=0` to turn this off.

The card cannot type into that other terminal. When you send a prompt from the card, the
workspace continues the chat as its own branch (a forked Claude Code session with the same
history), so the original chat is never written to and can carry on independently. The card
then stops mirroring and runs like any other agent.

## Closing the laptop

Session metadata and transcripts are on disk, so nothing is lost by sleeping the machine or
restarting the server. Sleep pauses the server and any running agent and they continue on
wake. If the server itself is stopped while an agent is mid-turn, that turn ends; the card
comes back as `Stopped` with a note and `Resume` picks the conversation up from Claude Code's
own saved transcript.

## States and what a card shows

`Running` → `Done`, `Error`, or `Stopped` (you pressed Stop). `Needs input` is a Claude Code
permission prompt or `AskUserQuestion`; answer it on the banner (Stop is there too), or in the
chat's full view. Stop and Resume are run
controls. Closing a card only moves it to _Closed sessions_ and never stops the run; undo
from the notice or reopen from the panel.

Each tool step shows as a small block under the reply that ran it: the tool, what it was asked,
and what came back. Steps are folded to one row; a failed step and the latest one are open. A step that edits a file shows the
lines it takes out and puts in. Messages carry their time; for a mirrored chat that is the time
Claude Code saved with the message.

While a Claude Code agent is running, the card header counts the run's elapsed time, and the
chat names the step it is on beside the working dots, with a timer: `Thinking`, `Preparing Bash`, `Running Bash`, `Reading the result`, `Writing the
reply`, plus subagent, retry and compaction steps. These are status labels only. The card shows that Claude is thinking and for how long, never the thinking itself: the server does not read thinking content. Codex shows plain `Working`.

A mirrored chat runs in its own window, so its card follows that window instead: while the chat
is busy the card shows `Running` with `Working in VS Code` (or `Running Bash in VS Code` when its
saved history ends on a tool call) and how long it has been busy. Stop and Send still act only on
workspace runs. New messages arrive whole, within about three seconds of Claude Code saving
them; a mirrored reply does not appear word by word.

Model and permission changes (in the full view, or behind the sliders button on a card) apply to the next prompt;
a run already under way keeps what it started with.

**Permissions**, beside the chips, sets the mode on every card at once and makes it
the starting mode for new cards and for chats mirrored in later. It is saved in
`~/.agent-workspace/settings.json`, so it survives a restart. `Bypass all permission checks`
means agents run every command, edit and connected tool (anything your MCP servers can do)
without asking; `Auto` asks far less than the default while still stopping on risky calls. The
setting covers runs the workspace starts. A chat that is running in VS Code still asks in VS Code.

Sending a prompt scrolls the card to the latest message and keeps following the reply. A card
you left at the latest message reopens there; one you had scrolled back in reopens where you
were reading.

## Where state lives

- Sessions and transcripts: `~/.agent-workspace/sessions.json` (override with `DATA_DIR`).
  A run cannot survive a server restart, so such sessions come back as `Stopped` with a note.
- Per-browser view state (focused card, drafts, scroll positions, card order, pins): `localStorage`.

File links in a reply (`[x](out/x.html)`, absolute paths, `file://`) open through the server at
`/api/files/<absolute path>`, resolved against the agent's folder. It serves files under the
repos folder, any session's folder and the temp folders; everything else is a 404. Served pages
run sandboxed so a script in one cannot reach the workspace API.

## Code layout

```
shared/                types shared by server and page; the topic list (topics.ts)
server/                Node 22 + Hono + ws
  session_manager.ts   state machine: runs, pending questions, stop/resume, close/reopen
  providers/           claude_code (Agent SDK), codex (exec --json), demo
  security.ts          the checks that keep other sites away from the local server
web/src/               React 19 + Vite
e2e/                   Playwright flows against the demo provider
```
