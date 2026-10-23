# Flow: ask Herman, get a proposal, press Apply

Trigger: a click on the persona in its corner (`open` in src/renderer/src/herman/Dock.tsx:378), or Ctrl+J, the shortcut of the `toggle-assistant` command (`AI_COMMANDS` in src/shared/ai.ts, collected into `APP_SHORTCUTS` by src/shared/shortcuts.ts) matched in `before-input-event` (src/main/menu.ts). On macOS the menu accelerator is the path. The command palette (Ctrl+K) and the sparkle button of the top bar run the same command (src/renderer/src/commands/builtin.ts, src/renderer/src/shell/TopBar.tsx). Since 0.8.0 there is no side panel: the conversation is a balloon that comes out of the persona.

## Open the balloon

1. `attachShortcuts` (src/main/menu.ts) sends the command to the window; the renderer subscribes with `window.api.onCommand` — src/renderer/src/shell/useShellCommands.ts; the `toggle-assistant` handler of the AI feature (src/renderer/src/ai/feature.ts) goes through `showOrHideAssistant` (src/renderer/src/shell/panels.ts:15) to `toggleAssistant`, which flips `balloonOpen` — src/renderer/src/ai/gate.ts:92
2. `BalloonHost`, a `content` overlay of the AI feature (order 15, just above the persona's corner), lazy-loads `Balloon` while the gate is enabled and open — src/renderer/src/ai/feature.ts:12, src/renderer/src/ai/Host.tsx:17. The balloon is one component whether the persona is on or off; it reads `useHerman.on` for the name and the copy — src/renderer/src/ai/Balloon.tsx:288
3. Where it goes: the Dock publishes the persona's corner and size into the always-loaded gate (`setBalloonAnchor`, src/renderer/src/herman/Dock.tsx:260, src/renderer/src/ai/balloonGate.ts:80); `usePlacement` (src/renderer/src/ai/Balloon.tsx:237) feeds that, the area's size, the balloon's height and the page's caret (`caretBox`, src/renderer/src/herman/avoid.ts:13, the same the Dock uses) into the pure `placeBalloon` — src/renderer/src/ai/placement.ts:43. Beside the figure with a tail toward it; above it when the area is narrow; at the other edge (or faded) when the caret is under it. While it is open the Dock adds `is-talking` and holds its own speech bubble — src/renderer/src/herman/Dock.tsx:439
4. Before anything is typed the balloon shows up to four suggestions chosen without AI from the moment (`useMoment` reads overdue tasks from `briefing.get` and whether the open page is a transcribed meeting) — `suggestionsFor`, src/renderer/src/ai/suggest.ts:86. A suggestion is sent as a question (`suggest`, src/renderer/src/ai/Balloon.tsx:385); the meeting one runs the page's own "Write up notes" (`requestPageAi(pageId, 'consolidate')`) instead
5. Focus: the field takes the keyboard once the balloon is placed, Tab stays inside, Esc stops a running answer, then leaves "Earlier" or the log, then closes (`onKeyDown`, src/renderer/src/ai/Balloon.tsx:432); on close the focus and the selection go back to where they were (`useFocusReturn`, src/renderer/src/ai/Balloon.tsx:215)

## Ask

6. `send` checks `aiReady` first — src/renderer/src/ai/Balloon.tsx:370; `aiReady` at src/renderer/src/ai/gate.ts:120
7. `ask` (src/renderer/src/ai/conversations.ts:329) finds or creates the conversation in front of the tab's route, appends the question and starts the answer: `answer` calls `startRun` with an `ask` request (page id or `today`, selection, history) — src/renderer/src/ai/conversations.ts:291, src/renderer/src/ai/conversations.ts:322. The run handle is kept per conversation, so an answer keeps streaming when the balloon closes or the tab changes. `startRun` at src/renderer/src/ai/client.ts:42 subscribes once to `window.api.ai.onEvent`, then calls `window.api.ai.run`
8. Preload namespace `ai` — src/preload/index.ts; main handler `ai:run` — src/main/ai/register.ts; the `AiBridge` is created lazily there

## Main process

9. `AiBridge.run` validates with `aiRequest` — src/main/ai/index.ts:125; defined at src/main/ai/request.ts:49. An `ask` starts with the workspace tools, up to `HERMAN_TURNS` turns — src/main/ai/index.ts:23, src/main/ai/index.ts:131
10. `start` registers per-window cancellation and batches deltas — src/main/ai/index.ts:188-235; `service.run` returns an id at once — src/main/ai/service.ts:321
11. `AiService.launch` resolves the Claude CLI (src/main/ai/service.ts:448-463; `locateCli` in src/main/ai/locate.ts), grants the tools (src/main/ai/service.ts:475), then loads the context and builds the prompt — `AiBridge.context` at src/main/ai/index.ts:76 (`loadContext` at src/main/ai/request.ts:138, `buildWorkspace` at src/main/ai/context.ts:178); `buildPrompt` at src/main/ai/prompts.ts:289 fences each section with a random nonce
11a. Every request also gets Settings → AI → Context: `loadStanding` reads `ai.context` (the user's own words) and the pages pinned in `ai.contextPages` — src/main/ai/index.ts:114, src/main/ai/standing.ts; `buildPrompt` puts the text in a USER CONTEXT section that, like USER REQUEST, is not listed as data, and the pages in a fenced PINNED PAGES data section — src/main/ai/prompts.ts:421, src/main/ai/prompts.ts:467
11b. An `ask` asks for the user's own MCP servers too (`external: true`, src/main/ai/index.ts:163). `AiBridge.externalPlan` reads which are on (`ai.mcpServers`), Claude Code's `~/.claude.json` and the stored catalog (`ai.mcpCatalog`), and `planExternal` returns the servers to copy into the request's `--mcp-config`, and a `--settings` file with `allowedMcpServers` (when a claude.ai connector is on) and `permissions.allow/deny` — src/main/ai/index.ts:331, src/main/ai/claudeMcp.ts:236, src/main/ai/service.ts:555. `toolArgs` then drops `--strict-mcp-config` only when a connector is on, adds `--settings`, and the run gets at least `EXTERNAL_TURNS` turns — src/main/ai/command.ts:115-120, src/main/ai/service.ts:111
12. `execute` spawns the CLI without a shell in the sandbox directory — src/main/ai/service.ts:221, src/main/ai/service.ts:512; the prompt goes in on stdin only
13. Events reach the requesting window as `ai:delta`, `ai:done`, `ai:error` — src/main/ai/index.ts:209-227; channel names at src/shared/ai.ts:134. `ai:done` carries `sent` (context, pinned page titles, server names) from `sentOf` — src/main/ai/service.ts:598

## Renderer receives

14. The preload fans the channels into `onEvent`; the client routes by run id — src/renderer/src/ai/client.ts:21-35; each event is reduced by `reduceRun` into the assistant message of its conversation — src/renderer/src/ai/machine.ts:46, src/renderer/src/ai/conversations.ts:291
15. When an answer ends, the conversation is written to `ai.conversations` a moment later (`persistSoon` → `persistNow`, src/renderer/src/ai/conversations.ts:194) and, when it is done, `emitReplyDone` tells whoever listens (`onReplyDone`, the door for the persona's memory) — src/renderer/src/ai/conversations.ts:313, src/renderer/src/ai/balloonGate.ts:125
15a. Under the answer, `SentNote` says what went along ("Sent along: your context · tools: Veleiro"), and `Notes` shows lines other features add with `addReplyNote` — src/renderer/src/ai/Balloon.tsx:740-741, src/renderer/src/ai/SentNote.tsx, src/renderer/src/ai/balloonGate.ts:140
16. On render, `splitActions` strips the `sel-actions` block and yields actions — src/renderer/src/ai/Balloon.tsx:701; defined in src/shared/actions.ts; the proposal card shows only when the run is done

## Apply

17. The Apply button calls `apply`, then `applyActions` — src/renderer/src/ai/Balloon.tsx:396; defined at src/renderer/src/ai/applyActions.ts:43
18. `planActions` turns actions into block ops — src/renderer/src/ai/actions.ts:206
19. `applyOps` sends them through the ordinary write path — src/renderer/src/ai/applyActions.ts:58
20. Terminal: `blocks:apply` — src/main/ipc.ts (continues as in [edit-to-disk](edit-to-disk.md))
21. `recordApplied` logs the batch in `ai.applied`: when, the question, the lines done and left out, the pages it touched (`pagesTouched`) and the inverse ops (`undo`) — src/renderer/src/ai/appliedStore.ts:116. The card then says what was done and offers "Undo all of this"

## Undo all of this

22. From the card, from the log in the balloon or from Settings → AI (`UndoControls`, src/renderer/src/ai/AppliedLog.tsx). `checkUndo` reads the blocks the undo would write and `changedSince` lists those written after the batch; if any, the first press warns and the second undoes anyway — src/renderer/src/ai/appliedStore.ts:105
23. `undoAppliedEntry` runs `undoApplied` (trashed pages restored, then the inverse batch through `applyOps`) and marks the entry `undoneAt` — src/renderer/src/ai/appliedStore.ts:148, src/renderer/src/ai/applyActions.ts:67. A card whose entry was undone shows the proposal again

## Answers that arrive on their own (for routines)

- `offerInBalloon(line, delivery)` has the persona say a line in its corner bubble with a button; the button calls `openInBalloon`, which opens the balloon on a conversation made from the delivery (`deliver`, src/renderer/src/ai/conversations.ts:390), proposal included; nothing is applied — src/renderer/src/ai/balloonGate.ts:92-109, src/renderer/src/herman/Dock.tsx:269. With the persona off the line is a toast with the same button

## State touched

- Settings read: the `ai.*` keys (src/shared/ai.ts), among them `ai.context`, `ai.contextPages`, `ai.mcpServers` and the main-written `ai.mcpCatalog` (src/shared/aiContext.ts), and Herman's voice (`herman.enabled`, `herman.voice`). None of them syncs.
- Read, not stored: Claude Code's `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`), at each ask and each time Settings lists the servers.
- Settings written: `ai.conversations` (the last 30 conversations, `fitConversations`) and `ai.applied` (the last 30 batches with their undo, `fitAppliedLog`), both cleaned again by main through `cleanAiSetting` and never synced — src/shared/aiHistory.ts, src/shared/ai.ts:208-211. "Delete all" (balloon "Earlier" or Settings → AI) clears the first.
- Database writes: only on Apply (src/main/ipc.ts:163).
- Filesystem: the sandbox directory used as the child's working directory, which holds only the request's MCP configuration and, with servers of the user's on, its `--settings` file; both are mode 0600 and removed when the request ends (src/main/ai/toolhost.ts).
- Which conversation is in front of which route is in memory only (`useConversations.active`, src/renderer/src/ai/conversations.ts).

## Failure handling

- CLI unavailable before asking: `aiReady` opens setup — src/renderer/src/ai/gate.ts:86; reasons are `AiUnavailableReason` (src/shared/ai.ts)
- Limits: 6 running, 8 queued, capped output — `AI_RUN_LIMITS` in src/main/ai/service.ts:37
- Timeout per child from `ai.timeoutSec`, at least `TOOL_TIMEOUT_MS` when the tools were granted — src/main/ai/service.ts:601
- Cancel is owner-checked and kills the process tree — src/main/ai/service.ts:363
- Malformed action block: no actions, `rejected` incremented (src/shared/actions.ts), and the balloon says so — src/renderer/src/ai/Balloon.tsx:723
- Apply failure: the card resets and `notifyError` fires — src/renderer/src/ai/Balloon.tsx:416
- Undo after later edits: the user is warned before those edits are overwritten; each page also kept a "Before Herman" version (src/renderer/src/ai/applyActions.ts:16)

## The user's own MCP servers (Claude Code 2.1.296, checked on 2026-10-22)

- `--restricted` loads none of the user's settings files, so no server of `~/.claude.json` and no plugin server; it still loads the claude.ai connectors unless `--strict-mcp-config` (or `--safe-mode`, `--bare`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `disableClaudeAiConnectors`) turns them all off. Without an allow-list, connectors are all or nothing.
- `allowedMcpServers` in a `--settings` file is honoured: a connector matches only by `serverUrl` (its display name "claude.ai X" does not match), a `--mcp-config` server by `serverName`. Everything not listed is dropped, with "blocked by enterprise policy" on stderr.
- Tool names: `mcp__<name with non [A-Za-z0-9_-] as _>__<tool>`, so "claude.ai Veleiro" → `mcp__claude_ai_Veleiro__get_me`. `permissions.deny` in the settings file removes tools from the model's list (wildcards work); with `--permission-prompts none`, any tool not in `permissions.allow` or `--allowedTools` is denied when called.
- Connector addresses are in no local file: `claude mcp list` prints them (`AiBridge.scanServers`, src/main/ai/index.ts:345, parsed by `parseMcpList`, src/main/ai/claudeMcp.ts:128). Tools are read from the `system/init` event of a start that is stopped there (`serverTools`, src/main/ai/index.ts:356); a start always needs a prompt, so it may count as one small request.

## Tests covering this flow

- src/main/ai/claude.test.ts (MCP configuration from fixtures, the plan and arguments of one request, the context in prompts),
- src/main/ai/ai.test.ts, src/main/ai/ipc.test.ts, src/main/ai/herman.test.ts, src/main/ai/tools.test.ts, src/renderer/src/ai/actions.test.ts
- The balloon in happy-dom (dialog, focus, suggestions, streaming, proposal, Esc, "Earlier", axe): src/renderer/src/ai/Balloon.test.tsx; suggestions src/renderer/src/ai/suggest.test.ts; placement src/renderer/src/ai/placement.test.ts; stored values src/shared/aiHistory.test.ts; Apply → log → restart → undo round trip src/renderer/src/ai/appliedStore.test.ts, src/renderer/src/ai/applyActions.test.ts
- Fixture: src/main/ai/fixtures/fake-claude.mjs
