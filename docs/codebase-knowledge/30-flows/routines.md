# Flow: a routine of the persona (0.8.0 épico C)

Trigger: the clock in the main process, while at least one routine is on (Settings → AI → Routines, or the onboarding through `enableRoutines`), or "Run routine now: …" in the palette (and the "Run now" buttons of Settings). All routines are off by default (`ROUTINE_DEFAULTS`, src/shared/routines.ts). Principle: assisted, never autonomous: a routine runs the AI in the background, its answer waits behind one line of the persona, and nothing in the workspace changes until the user presses Apply in the balloon.

## The routines

| id | when (default) | AI | what it prepares |
|---|---|---|---|
| `morning` | 08:30, window 3 h | yes, with the workspace tools and the user's MCP servers read only | C2: three priorities, what to postpone, time blocks in the free stretches → `update-tasks` |
| `midday` | 13:30, window 2 h | yes | a check-in; moves what will not fit → `update-tasks` (optional) |
| `evening` | 17:30, window 3 h | yes | C4: done / left / tomorrow → `close-day` (today's line in Meditations, tomorrow's plans) |
| `weekly` | Friday (or Sunday) 17:00, window 4 h | no | offers the weekly review; the review's "Summarise with the persona" writes the question into the balloon, unsent |
| `stalled` | 10:30, window 6 h | yes, only when a task is stuck | C3: one stuck task and one way out → `add-subtasks`, `update-tasks` (title) or `trash` |

## The clock (main)

1. `routinesFeature` registers with the other features (src/main/features.ts); `start()` looks 30 s after the first window, then `look` re-arms itself — src/main/routines/register.ts:122, src/main/routines/register.ts:151. While no routine is on it reads the setting every 30 minutes and loads nothing else; writing `ai.routines` re-arms it in 5 s (`onSettingChanged`, src/main/routines/register.ts:145).
2. `RoutinesService.tick` (src/main/routines/service.ts:154) asks the pure `dueRoutine` (src/main/routines/schedule.ts:144): routines that are on, in their window today (`windowOf`, src/main/routines/schedule.ts:121; the weekly one on its day only) and not run today. Never at night or in the quiet hours (`isNight`: before 06:00, from 22:00, and `herman.quietHours`, src/main/routines/schedule.ts:95). Missed ones do not pile up: when several are due (the app opened late), the one whose time is latest runs and the others are marked as run (`skip`).
3. The state (`ai.routinesState`: the day each routine last ran, the day the limit was said, the tasks the stalled routine offered, when a routine last spoke) is written by main only; no settings spec names it, so no window can.
4. `perform` (src/main/routines/service.ts:186): AI off → nothing; the daily limit reached (`routineRequests` of `ai.usage` ≥ `limit`, default 6) → the line "That is all the routines for today…" once a day (`limitSaid`) and nothing runs. Otherwise the data is read and the prompt built:
   - `dayData` / `closeData` (src/main/routines/data.ts:129, src/main/routines/data.ts:170) from the briefing as stored (`briefing.stored()`), the Tasks database (projects and next actions via `projectOverview`), the free stretches (`freeToday`, src/main/routines/data.ts:107, with shared/tasks/blocks.ts `freeSpans`, 08:00–19:00) and, for the close, `NotebookService.review()` (completed tasks, edited pages, today's line, tomorrow's plans). Only tasks of the built-in Tasks database carry an id (`[id]`): the others can be mentioned, not changed.
   - Private from the AI (A5) is left out: every task and item goes through `privacyChecker`, and the projects in `aiPrivateProjects` are dropped with their tasks.
   - `stalled`: `findStalled` (src/main/routines/stalled.ts:60) over the Tasks rows and 30 days of the activity log: put off 3+ times (`task.postponed` rows, which now keep the task's id, src/main/db/activity.ts:232) or open and untouched 14+ days; never done, repeating, subtasks, private, or offered in the last 14 days. Nothing stuck → no AI.
   - `buildRoutinePrompt` (src/main/routines/prompts.ts:170): titles fenced as data with a random nonce, the persona's voice when it is on, only the actions the routine may propose, the user's context (`ai.context`), the language.
5. `ask` (src/main/routines/register.ts:80) records an `ai` row in the activity log with area `routine:<id>` and runs the prompt with `AiBridge.service.runPrompt(…, owner null, { origin: 'routine:<id>', tools? })`: no window is needed. The morning plan gets the tools with `external: 'read'`: `AiBridge.externalPlan(true)` gives every server the user turned on read-only access, whatever Settings says (src/main/ai/index.ts:368).
6. The answer becomes a `RoutineOffer` (`kind: 'balloon'` with a `delivery`, `'review'`, or `'note'`), held in memory until the end of the day (`hold`, src/main/routines/service.ts:168), and every window hears `routines:ready`.

## Saying it (renderer)

7. `initRoutines` (src/renderer/src/routines/client.ts:101), started by the `routines` feature in every workspace window, asks `routines:next` at quiet moments: 25 s after start, 20 s after the last key, when the window comes back, and when `routines:ready` arrives. It reports `idleMs` and `busy` (the balloon or a dialog open, the window not focused).
8. `next` (src/main/routines/service.ts:270) asks `mayDeliver` (src/main/routines/schedule.ts:190): not at night, not within 20 minutes of the last thing a routine said, not while busy (main also checks recording, full screen, minimized, not focused), not before 20 s without a key. The first offer that waits is handed over once.
9. `show` (src/renderer/src/routines/client.ts:55): a `balloon` offer goes to `offerInBalloon(line, delivery, label)`; `review` and `note` go to `sayInCorner` (src/renderer/src/ai/balloonGate.ts:119), a line with a button that runs something else (open the review) or none. The Dock turns either into its bubble (src/renderer/src/herman/Dock.tsx); with the persona off it is a toast.
10. "Show me" opens the balloon on the delivery (`deliver`), the proposal included; Apply goes through `applyActions` like any proposal and is logged with "Undo all of this" (B4; see [ask Herman and Apply](herman-ask-apply.md)).

## "Run routine now"

`runRoutine` (src/renderer/src/routines/client.ts:69): the weekly one opens the review; the others check `aiReady`, show "Preparing it…", call `routines:run` → `runNow` → `perform(id, manual = true)`, which ignores the time and the daily limit (the request is still counted under `routine:<id>`) and throws a failure for the window to show; the offer opens in the balloon at once.

## The actions the routines propose (src/shared/actions.ts:311)

- `update-tasks`: `{ id, due?: 'YYYY-MM-DD' | null, priority?: 'P1'…'P4' | null, block?: { start, end }, title? }`, for rows of the Tasks database only. `taskPatch` (src/renderer/src/ai/actions.ts:648): a new due day keeps the time of day (a block moves whole); a block goes on the `due` given with it, else today (a late task is done today); priorities by their option ids `tasks.p1…`.
- `add-subtasks`: `{ task, titles }` → rows with `tasks.parent` and the parent's project.
- `close-day`: `{ line?, plans? }` → today's notebook entry (`sel-notebook-<day>`, added after what the user wrote, `cleanLine`) and tomorrow's `plans` (kept with those already set, three at most). Meditations is started with its fixed id when it does not exist yet.
- All three are planned by `planActions` (src/renderer/src/ai/actions.ts:541) and undone by the generic `invertOps`.

## Usage, cost and the limit (C5)

- `AiService` reports every request that reached the program (`job.child` set) through `onUsage` from `settle` (src/main/ai/service.ts:511): `origin` (`RunTarget.origin`, `you` by default), the time, `ok`, and `total_cost_usd` from the result event (`readEvent`, src/main/ai/ndjson.ts; kept at src/main/ai/service.ts:715).
- `AiBridge` adds it to `ai.usage` (src/main/ai/index.ts:97, `addUsage` in src/shared/aiUsage.ts): day → origin → requests, ms, cost and how many reported a cost; 14 days kept; written by main only.
- Any feature counts itself by passing `{ origin: '<name>' }` to `runPrompt`/`run` (the persona's memory: `memory`). Settings → AI → Usage (`routines:usage`, `usageSummary`) shows today and the last 7 days by origin, and "Routines today: n of limit".

## State touched

- Settings: `ai.routines` (renderer-writable, cleaned by `cleanRoutinesSetting`, not synced), `ai.routinesState` and `ai.usage` (main only, not synced). Reads `ai.enabled`, `ai.language`, `ai.context`, `herman.quietHours`, `herman.persona`/`herman.voice` (through the AI service).
- Database writes: none from a routine; only Apply in the balloon.
- Activity log: one `ai` row per routine request (`area: routine:<id>`); `task.postponed` rows keep the task id.

## Development

`SEL_ROUTINES_FAST=1` in an unpackaged build (`fastDue`, src/main/routines/schedule.ts:168): every routine that is on runs at once at any hour, once a day; delivery skips the night and the gap; an unfocused window driven by an automated check is not busy. The fake CLI (src/main/ai/fixtures/fake-claude.mjs) answers each routine's task with a proposal built from the ids in its sections and reports a small cost.

## Tests

src/main/routines/schedule.test.ts (fake clock: times, windows, quiet hours, night, missed routines, delivery rules), src/main/routines/service.test.ts (once a day, held until idle, the limit said once, manual runs, weekly without AI, stalled once a day, AI off or failing), src/main/routines/stalled.test.ts, src/main/routines/data.test.ts (day and close data, privacy, prompts), src/shared/routines.test.ts (setting, usage counts), src/main/ai/usage.test.ts (origin and cost from the stand-in program), src/renderer/src/ai/taskActions.test.ts (validation, Apply and undo of the three actions).
