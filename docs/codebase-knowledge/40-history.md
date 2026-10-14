# History and ownership

The whole visible history is 35 commits, all dated 2026-10-13, 30 of them non-merge
(`git log`, this session). Dates therefore say nothing about pace; only order matters.

## Timeline of structural decisions

| When | What | Why (documented / inferred) | Evidence (commit) |
|---|---|---|---|
| 1 | Initial import as "Selida": blocks, databases, editor, shell, store, versions | Inferred: the project arrives whole, so earlier history was squashed or lived elsewhere | commit 812b72a |
| 2 | AI actions through the local Claude Code CLI | Documented: "The CLI runs headless with no tools, the prompt on stdin, and page content passed as delimited data" | commit 85162f8 |
| 3 | Zen becomes the default look | Inferred from the subject line | commit 5f843cb |
| 4 | iCalendar parser, briefing service, Today screen | Documented in subjects: calendars over https, open tasks, phrase of the day | commit ed6ebb8, commit 705e51a, commit f5f4988 |
| 5 | GitHub sync for one person's devices | Documented: "one JSON file per page in a private git repository"; "the later edit wins and the other is kept in version history" | commit 9c93ac1 |
| 6 | Briefing and sync merged | Documented: "Both features add an API namespace, IPC handlers and a Settings section; keep both" | commit e1a5194 |
| 7 | Meeting recording with local transcription | Documented: "Audio stays local and is never part of sync; the engine is downloaded once, on request, and verified against pinned digests" | commit 3d7fb14 |
| 8 | Herman: settings, non-AI counsel, scheduler, voice, drawn figure | Documented in subjects | commit 12e91f2, commit 90e14c5, commit f9567f7 |
| 9 | Rename to "sel", carrying over stored data | Documented: "the data folder and the database file are renamed on the first start; a migration rewrites the addresses stored in blocks and settings" | commit adde475 |
| 10 | App icon, then tag v0.1.0 | Tag points at the icon fix | commit 6454ef8, commit ba9c680 |
| 11 | Generated shapes replace emojis as page icons | Documented: "Icons saved as emojis are not rewritten: the emoji is the seed" | commit 5f979c1 |
| 12 | Calendar screen with month, then week | Documented in subjects | commit fd0149e, commit b36d895 |
| 13 | Version 0.2.0 | | commit 4f4042f |
| 14 | Herman gets workspace context, a council, other CLIs and proposals | Documented: "nothing is created until Apply is pressed, and the ops go through the same pipeline as the user's own edits"; running limit raised from two to four | commit 8acaec9 |

## Hotspots (churn; say "repo is N days old" when churn is meaningless)

The repo's visible history spans a single day, so churn counts measure how many features
touched a file, not instability. Read them as "integration points every new feature must edit".

| File | Commits touching it | Why it is touched |
|---|---|---|
| README.md | 9 | Feature list grows with each feature (inventory script, this session) |
| src/shared/api.ts | 9 | Each feature adds an API namespace (src/shared/api.ts:24) |
| src/preload/index.ts | 8 | Each feature adds a namespace method list (src/preload/index.ts:27-28) |
| src/renderer/src/shell/SettingsDialog.tsx | 8 | Each feature adds a settings section (src/renderer/src/shell/SettingsDialog.tsx:38-42) |
| src/main/ipc.ts | 7 | Each feature registers handlers (src/main/ipc.ts:223-254) |
| src/renderer/src/shell/Shell.tsx | 7 | Each feature mounts a host (src/renderer/src/shell/Shell.tsx:5-9) |
| src/renderer/src/main.tsx | 7 | Each feature adds an `init*` call (src/renderer/src/main.tsx:38-56) |
| src/main/validate.ts | 6 | Each feature adds writable setting keys (src/main/validate.ts:35) |
| src/main/ai/index.ts, src/main/ai/prompts.ts | 6 each | Briefing, meetings and Herman all route through the AI bridge (src/main/ai/index.ts:310) |

## Ownership concentration (truck factor)

| Area | Main author(s) | Risk |
|---|---|---|
| Entire repository | One person under two git names, "Érik S." (29) and "Érik Schünemann" (5, the merge commits) (`git shortlog -sn`, this session) | Truck factor 1 |
| All feature commits | Each carries a `Co-Authored-By: Claude` trailer (commit 9c93ac1, commit 3d7fb14, commit adde475) | Rationale lives in commit bodies and code comments rather than in a second person's head |

## Candidate ADRs (inferred, not documented)

Each is inferred from code and commit messages; none exists as a decision record.

1. **Everything is a block.** Pages, databases and rows share one table and one op pipeline (src/shared/types.ts:1, src/main/db/schema.ts:9).
2. **The renderer is untrusted.** Sandbox, CSP and validation on every call (src/main/index.ts:108-110, src/main/ipc.ts:69-90).
3. **AI through the user's own CLI, never an API key.** The child gets an allow-listed environment with no API keys (src/main/ai/command.ts:119-190); commit 85162f8.
4. **AI output never writes directly.** Inline results wait for accept (src/renderer/src/ai/session.ts:1-3); proposals wait for Apply (commit 8acaec9).
5. **Sync by plain git on files the user owns, not a server.** No token is stored (src/shared/sync.ts:4-5); commit 9c93ac1.
6. **Conflict policy: merge field by field; where both sides changed the same thing differently the later edit wins, and the loser is kept as a version.** (src/main/sync/merge.ts:8-20, src/main/sync/engine.ts:778-791, src/main/db/repository.ts:1470-1479).
7. **One runtime dependency.** Everything except the native SQLite module is bundled (electron.vite.config.ts:58-59, package.json:18-20).
8. **Charts, diffing, iCalendar parsing and zip reading are hand-written rather than imported.** (src/renderer/src/database/views/chartPlot.tsx:178, src/renderer/src/versions/diff.ts:3-6, src/main/briefing/ical.ts:680, src/main/meetings/whisper/zip.ts:137); consistent with README.md:42.
9. **Tests avoid Electron and a DOM library.** Services are Electron-free with injected clocks (src/main/herman/service.ts:69-70); no jsdom is installed (package.json:21-37).
10. **Rename without data loss.** Legacy profile adoption and URL rewriting are kept as permanent code (src/main/legacy.ts:18, src/shared/legacy.ts:12); commit adde475.

Abandoned approaches visible in history: emojis as page icons (commit 5f979c1), the "Glass" look as default (src/renderer/src/appearance/presets.ts:4-5; commit 5f843cb), two concurrent AI runs (commit 8acaec9).
