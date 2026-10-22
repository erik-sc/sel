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
9. `execute` spawns the CLI without a shell in the sandbox directory — src/main/ai/service.ts:221, src/main/ai/service.ts:512; the prompt goes in on stdin only
10. Events reach the requesting window as `ai:delta`, `ai:done`, `ai:error` — src/main/ai/index.ts:209-227; channel names at src/shared/ai.ts:134

## Renderer receives

11. The preload fans the channels into `onEvent` — src/preload/index.ts:61; the client routes by run id — src/renderer/src/ai/client.ts:21-35; the run state is reduced by `reduceRun` — src/renderer/src/ai/machine.ts:46
12. On render, `splitActions` strips the `sel-actions` block and yields actions — src/renderer/src/ai/AssistantPanel.tsx:417; defined at src/shared/actions.ts:257; the proposal card shows only when the run is done — src/renderer/src/ai/AssistantPanel.tsx:429

## Apply

13. The Apply button calls `apply`, then `applyActions` — src/renderer/src/ai/AssistantPanel.tsx:242-246; defined at src/renderer/src/ai/applyActions.ts:43
14. `planActions` turns actions into block ops — src/renderer/src/ai/actions.ts:206
15. `applyOps` sends them through the ordinary write path — src/renderer/src/ai/applyActions.ts:58
16. Terminal: `blocks:apply` — src/main/ipc.ts:163 (continues as in [edit-to-disk](edit-to-disk.md))

## State touched

- Settings read: the `ai.*` keys (src/shared/ai.ts:138) and Herman's voice (`herman.enabled`, `herman.voice`).
- Settings written: none in this flow.
- Database writes: only on Apply (src/main/ipc.ts:163).
- Filesystem: the sandbox directory used as the child's working directory, which holds only the tools' MCP configuration.
- Chats and the proposal outcome are in memory only (src/renderer/src/ai/AssistantPanel.tsx:51).

## Failure handling

- CLI unavailable before asking: `aiReady` opens setup — src/renderer/src/ai/gate.ts:86; reasons are `AiUnavailableReason` (src/shared/ai.ts)
- Limits: 6 running, 8 queued, capped output — `AI_RUN_LIMITS` in src/main/ai/service.ts:37
- Timeout per child from `ai.timeoutSec`, at least `TOOL_TIMEOUT_MS` when the tools were granted — src/main/ai/service.ts:601
- Cancel is owner-checked and kills the process tree — src/main/ai/service.ts:363
- Malformed action block: no actions, `rejected` incremented (src/shared/actions.ts:281), and the panel says so — src/renderer/src/ai/AssistantPanel.tsx:443
- Apply failure: the card resets and `notifyError` fires — src/renderer/src/ai/AssistantPanel.tsx:265

## Tests covering this flow

- src/main/ai/ai.test.ts, src/main/ai/ipc.test.ts, src/main/ai/herman.test.ts, src/main/ai/tools.test.ts, src/renderer/src/ai/actions.test.ts
- Fixture: src/main/ai/fixtures/fake-claude.mjs
