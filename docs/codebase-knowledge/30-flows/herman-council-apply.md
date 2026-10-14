# Flow: ask Herman with Council on, get a proposal, press Apply

Trigger: Ctrl+J, a `SHORTCUTS` entry (src/main/menu.ts:37) matched in `before-input-event` (src/main/menu.ts:163, match at src/main/menu.ts:172-179). On macOS `attachShortcuts` returns early (src/main/menu.ts:162) and the menu accelerator is the path (src/main/menu.ts:128).

## Open the panel

1. `attachShortcuts` is attached to each window — src/main/index.ts:128; defined at src/main/menu.ts:161; it calls `sendCommand`, which sends `IPC.command` to the window — src/main/menu.ts:43-46
2. The renderer subscribes with `window.api.onCommand` — src/renderer/src/shell/useShellCommands.ts:31; the `toggle-assistant` case calls `toggleAssistant` — src/renderer/src/shell/useShellCommands.ts:78-79; defined at src/renderer/src/ai/gate.ts:62
3. `AssistantDock` lazy-loads `AssistantPanel` when the gate is enabled and open — src/renderer/src/ai/Host.tsx:8-19; mounted in the shell at src/renderer/src/shell/Shell.tsx:55. There is no separate Herman chat UI; the panel switches on Herman being on — src/renderer/src/ai/AssistantPanel.tsx:159

## Ask

4. The Council chip toggles an in-memory flag — src/renderer/src/ai/AssistantPanel.tsx:496
5. `send` checks `aiReady` first — src/renderer/src/ai/AssistantPanel.tsx:272; `aiReady` at src/renderer/src/ai/gate.ts:86
6. `answer` calls `startRun` — src/renderer/src/ai/AssistantPanel.tsx:245; defined at src/renderer/src/ai/client.ts:43; it subscribes once to `window.api.ai.onEvent` — src/renderer/src/ai/client.ts:25; then calls `window.api.ai.run` — src/renderer/src/ai/client.ts:65
7. Preload namespace `ai` — src/preload/index.ts:83; main handler `ai:run` — src/main/ipc.ts:195; the `AiBridge` is created lazily — src/main/ipc.ts:192

## Main process

8. `AiBridge.run` validates with `aiRequest` — src/main/ai/index.ts:127; defined at src/main/ai/request.ts:50; `ask` with `council` goes to `startCouncil` — src/main/ai/index.ts:131
9. `startCouncil` reads the enabled seats from the `herman.council` setting — src/main/ai/index.ts:138-141; key at src/shared/council.ts:94; with no seats it falls back to a plain run — src/main/ai/index.ts:161
10. `start` registers per-window cancellation and batches deltas — src/main/ai/index.ts:310-340; then `service.run` returns an id at once — src/main/ai/service.ts:307-312
11. `AiService.launch` resolves the Claude CLI, then awaits the job's prompt builder — src/main/ai/service.ts:422-447; `locateCli` at src/main/ai/locate.ts:164
12. The builder gathers context — src/main/ai/index.ts:85; `loadContext` at src/main/ai/request.ts:145; workspace context at src/main/ai/context.ts:158
13. All seats are consulted in parallel, each as its own job — src/main/ai/index.ts:199-201; `runPrompt` at src/main/ai/service.ts:326; per-seat progress goes out on the council channel — src/main/ai/index.ts:165-190
14. Herman's synthesis prompt is built with the opinions — src/main/ai/index.ts:204; sections are fenced with a random nonce — src/main/ai/prompts.ts:286-293
15. `execute` spawns the CLI without a shell in a sandbox directory — src/main/ai/service.ts:211-222; the prompt goes in on stdin only — src/main/ai/service.ts:566-571
16. Events reach the requesting window as `ai:delta`, `ai:done`, `ai:error` — src/main/ai/index.ts:322-349; channel names at src/shared/ai.ts:138

## Renderer receives

17. The preload fans the channels into `onEvent` — src/preload/index.ts:85-92; the client routes by run id — src/renderer/src/ai/client.ts:17-31; the run state is reduced by `reduceRun` — src/renderer/src/ai/machine.ts:46
18. On render, `splitActions` strips the `sel-actions` block and yields actions — src/renderer/src/ai/AssistantPanel.tsx:410; defined at src/shared/actions.ts:182; the proposal card shows only when the run is done — src/renderer/src/ai/AssistantPanel.tsx:422

## Apply

19. The Apply button calls `apply`, then `applyActions` — src/renderer/src/ai/AssistantPanel.tsx:260-263; defined at src/renderer/src/ai/applyActions.ts:11
20. `planActions` turns actions into block ops — src/renderer/src/ai/actions.ts:146
21. `applyOps` sends them through the ordinary write path — src/renderer/src/ai/applyActions.ts:23; src/renderer/src/store/blocks.ts:301
22. Terminal: `blocks:apply` — src/main/ipc.ts:113 (continues as steps 11-17 of [edit-to-disk](edit-to-disk.md))

## State touched

- Settings read: the `ai.*` keys (src/shared/ai.ts:142), `herman.council` (src/shared/council.ts:94), connected agents (src/main/ai/agents.ts:18).
- Settings written: none in this flow (tracer, this session).
- Database writes: only on Apply (src/main/ipc.ts:113).
- Filesystem: the empty sandbox directory used as the child's working directory (src/main/ai/service.ts:211-222).
- Chats, the Council toggle and the proposal outcome are in memory only (src/renderer/src/ai/AssistantPanel.tsx:61).

## Failure handling

- CLI unavailable before asking: `aiReady` opens setup — src/renderer/src/ai/gate.ts:86-91; reasons are `AiUnavailableReason` — src/shared/ai.ts:105
- A failed seat is marked failed and left out of the synthesis — src/main/ai/index.ts:173-190, src/main/ai/index.ts:202
- Limits: 4 running, 8 queued, capped output — src/main/ai/service.ts:35-48
- Timeout per child from `ai.timeoutSec` — src/main/ai/service.ts:193-198
- Cancel is owner-checked and kills the process tree — src/main/ai/service.ts:338-349, src/main/ai/service.ts:118-148; ending the outer job cancels the seats — src/main/ai/index.ts:206-209
- Malformed action block: no actions, `rejected` incremented — src/shared/actions.ts:218-221
- Apply failure: the card resets and `notifyError` fires — src/renderer/src/ai/AssistantPanel.tsx:265-268

## Tests covering this flow

- src/main/ai/council.test.ts:1, src/main/ai/ai.test.ts:1, src/main/ai/ipc.test.ts:1, src/renderer/src/ai/actions.test.ts:1, src/renderer/src/ai/ai.test.ts:1
- Fixtures: src/main/ai/fixtures/fake-claude.mjs:1, src/main/ai/fixtures/fake-agent.mjs:1
- No test matched `toggle-assistant` or `applyActions` (tracer grep, this session).

## Open questions

- `ParsedAnswer.rejected` is not read by the panel, so a malformed proposal vanishes without a note (src/shared/actions.ts:218-221); only test assertions read it (src/renderer/src/ai/actions.test.ts:26).
- Claude resolution is skipped only for jobs with a program target (src/main/ai/service.ts:428-441). Seat jobs have one, but the outer Herman job is started with a builder and no target (src/main/ai/index.ts:199-206), so a council made only of other programs still needs Claude installed. Intended?
- Five seats plus Herman exceed the 4 running slots (src/main/ai/service.ts:35-48); extras queue.
