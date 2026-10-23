# Flow: ask Herman, get a proposal, press Apply

Trigger: Ctrl+J, the shortcut of the `toggle-assistant` command (`AI_COMMANDS` in src/shared/ai.ts, collected into `APP_SHORTCUTS` by src/shared/shortcuts.ts) matched in `before-input-event` (src/main/menu.ts). On macOS the menu accelerator is the path. The command palette (Ctrl+K) runs the same command (src/renderer/src/commands/builtin.ts).

## Open the panel

1. `attachShortcuts` (src/main/menu.ts) sends the command to the window; the renderer subscribes with `window.api.onCommand` — src/renderer/src/shell/useShellCommands.ts; the `toggle-assistant` handler of the AI feature (src/renderer/src/ai/feature.ts) ends in `toggleAssistant` — src/renderer/src/ai/gate.ts:62
2. `AssistantDock` lazy-loads `AssistantPanel` when the gate is enabled and open — src/renderer/src/ai/Host.tsx. There is no separate Herman chat UI; the panel switches on Herman being on — src/renderer/src/ai/AssistantPanel.tsx:153

## Ask

3. `send` checks `aiReady` first — src/renderer/src/ai/AssistantPanel.tsx:270; `aiReady` at src/renderer/src/ai/gate.ts:86
4. `answer` calls `startRun` with an `ask` request (page id or `today`, selection, history) — src/renderer/src/ai/AssistantPanel.tsx:216-233; `startRun` at src/renderer/src/ai/client.ts:42 subscribes once to `window.api.ai.onEvent` (src/renderer/src/ai/client.ts:21-24), then calls `window.api.ai.run` — src/renderer/src/ai/client.ts:62
5. Preload namespace `ai` — src/preload/index.ts:59; main handler `ai:run` — src/main/ai/register.ts:28; the `AiBridge` is created lazily there

## Main process

6. `AiBridge.run` validates with `aiRequest` — src/main/ai/index.ts:125; defined at src/main/ai/request.ts:49. An `ask` starts with the workspace tools, up to `HERMAN_TURNS` turns — src/main/ai/index.ts:23, src/main/ai/index.ts:131
7. `start` registers per-window cancellation and batches deltas — src/main/ai/index.ts:188-235; `service.run` returns an id at once — src/main/ai/service.ts:321
8. `AiService.launch` resolves the Claude CLI (src/main/ai/service.ts:448-463; `locateCli` in src/main/ai/locate.ts), grants the tools (src/main/ai/service.ts:475), then loads the context and builds the prompt — `AiBridge.context` at src/main/ai/index.ts:76 (`loadContext` at src/main/ai/request.ts:138, `buildWorkspace` at src/main/ai/context.ts:178); `buildPrompt` at src/main/ai/prompts.ts:289 fences each section with a random nonce
8a. Every request also gets Settings → AI → Context: `loadStanding` reads `ai.context` (the user's own words) and the pages pinned in `ai.contextPages` — src/main/ai/index.ts:114, src/main/ai/standing.ts; `buildPrompt` puts the text in a USER CONTEXT section that, like USER REQUEST, is not listed as data, and the pages in a fenced PINNED PAGES data section — src/main/ai/prompts.ts:421, src/main/ai/prompts.ts:467
8b. An `ask` asks for the user's own MCP servers too (`external: true`, src/main/ai/index.ts:163). `AiBridge.externalPlan` reads which are on (`ai.mcpServers`), Claude Code's `~/.claude.json` and the stored catalog (`ai.mcpCatalog`), and `planExternal` returns the servers to copy into the request's `--mcp-config`, and a `--settings` file with `allowedMcpServers` (when a claude.ai connector is on) and `permissions.allow/deny` — src/main/ai/index.ts:331, src/main/ai/claudeMcp.ts:236, src/main/ai/service.ts:555. `toolArgs` then drops `--strict-mcp-config` only when a connector is on, adds `--settings`, and the run gets at least `EXTERNAL_TURNS` turns — src/main/ai/command.ts:115-120, src/main/ai/service.ts:111
9. `execute` spawns the CLI without a shell in the sandbox directory — src/main/ai/service.ts:221, src/main/ai/service.ts:512; the prompt goes in on stdin only
10. Events reach the requesting window as `ai:delta`, `ai:done`, `ai:error` — src/main/ai/index.ts:209-227; channel names at src/shared/ai.ts:134. `ai:done` carries `sent` (context, pinned page titles, server names) from `sentOf` — src/main/ai/service.ts:598

## Renderer receives

11. The preload fans the channels into `onEvent` — src/preload/index.ts:61; the client routes by run id — src/renderer/src/ai/client.ts:21-35; the run state is reduced by `reduceRun` — src/renderer/src/ai/machine.ts:46
11a. Under the answer, `SentNote` says what went along ("Sent along: your context · tools: Veleiro") — src/renderer/src/ai/AssistantPanel.tsx:459, src/renderer/src/ai/SentNote.tsx
12. On render, `splitActions` strips the `sel-actions` block and yields actions — src/renderer/src/ai/AssistantPanel.tsx:417; defined at src/shared/actions.ts:257; the proposal card shows only when the run is done — src/renderer/src/ai/AssistantPanel.tsx:429

## Apply

13. The Apply button calls `apply`, then `applyActions` — src/renderer/src/ai/AssistantPanel.tsx:242-246; defined at src/renderer/src/ai/applyActions.ts:43
14. `planActions` turns actions into block ops — src/renderer/src/ai/actions.ts:206
15. `applyOps` sends them through the ordinary write path — src/renderer/src/ai/applyActions.ts:58
16. Terminal: `blocks:apply` — src/main/ipc.ts:163 (continues as in [edit-to-disk](edit-to-disk.md))

## State touched

- Settings read: the `ai.*` keys (src/shared/ai.ts), among them `ai.context`, `ai.contextPages`, `ai.mcpServers` and the main-written `ai.mcpCatalog` (src/shared/aiContext.ts), and Herman's voice (`herman.enabled`, `herman.voice`). None of them syncs.
- Read, not stored: Claude Code's `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`), at each ask and each time Settings lists the servers.
- Settings written: none in this flow.
- Database writes: only on Apply (src/main/ipc.ts:163).
- Filesystem: the sandbox directory used as the child's working directory, which holds only the request's MCP configuration and, with servers of the user's on, its `--settings` file; both are mode 0600 and removed when the request ends (src/main/ai/toolhost.ts).
- Chats and the proposal outcome are in memory only (src/renderer/src/ai/AssistantPanel.tsx:51).

## Failure handling

- CLI unavailable before asking: `aiReady` opens setup — src/renderer/src/ai/gate.ts:86; reasons are `AiUnavailableReason` (src/shared/ai.ts)
- Limits: 6 running, 8 queued, capped output — `AI_RUN_LIMITS` in src/main/ai/service.ts:37
- Timeout per child from `ai.timeoutSec`, at least `TOOL_TIMEOUT_MS` when the tools were granted — src/main/ai/service.ts:601
- Cancel is owner-checked and kills the process tree — src/main/ai/service.ts:363
- Malformed action block: no actions, `rejected` incremented (src/shared/actions.ts:281), and the panel says so — src/renderer/src/ai/AssistantPanel.tsx:443
- Apply failure: the card resets and `notifyError` fires — src/renderer/src/ai/AssistantPanel.tsx:265

## The user's own MCP servers (Claude Code 2.1.296, checked on 2026-10-22)

- `--restricted` loads none of the user's settings files, so no server of `~/.claude.json` and no plugin server; it still loads the claude.ai connectors unless `--strict-mcp-config` (or `--safe-mode`, `--bare`, `ENABLE_CLAUDEAI_MCP_SERVERS=false`, `disableClaudeAiConnectors`) turns them all off. Without an allow-list, connectors are all or nothing.
- `allowedMcpServers` in a `--settings` file is honoured: a connector matches only by `serverUrl` (its display name "claude.ai X" does not match), a `--mcp-config` server by `serverName`. Everything not listed is dropped, with "blocked by enterprise policy" on stderr.
- Tool names: `mcp__<name with non [A-Za-z0-9_-] as _>__<tool>`, so "claude.ai Veleiro" → `mcp__claude_ai_Veleiro__get_me`. `permissions.deny` in the settings file removes tools from the model's list (wildcards work); with `--permission-prompts none`, any tool not in `permissions.allow` or `--allowedTools` is denied when called.
- Connector addresses are in no local file: `claude mcp list` prints them (`AiBridge.scanServers`, src/main/ai/index.ts:345, parsed by `parseMcpList`, src/main/ai/claudeMcp.ts:128). Tools are read from the `system/init` event of a start that is stopped there (`serverTools`, src/main/ai/index.ts:356); a start always needs a prompt, so it may count as one small request.

## Tests covering this flow

- src/main/ai/claude.test.ts (MCP configuration from fixtures, the plan and arguments of one request, the context in prompts),
- src/main/ai/ai.test.ts, src/main/ai/ipc.test.ts, src/main/ai/herman.test.ts, src/main/ai/tools.test.ts, src/renderer/src/ai/actions.test.ts
- Fixture: src/main/ai/fixtures/fake-claude.mjs
