# sel

A quiet place to write and keep things.

sel is a notes app for your desktop. Pages are made of blocks, databases are made of pages, and everything lives in one file on your computer.

![A page in sel, light theme](docs/page-light.png)

## What it does

**Write.** Headings, lists, to-dos, toggles, quotes, callouts, code, images and equations. Type `/` for any block (in English or Portuguese: `/titulo`, `/tarefa` and `/citação` work too), or use Markdown shortcuts as you go; `$$` starts an equation. Paste from a web page, Google Docs or an e-mail and the headings, lists, quotes, links and bold come along; images from the web stay behind, and nothing pasted is trusted. Pasted Markdown keeps its nested lists. The top bar keeps a quiet count of the page's words and reading time, or of what you have selected; Settings → General turns it off.

**Write LaTeX.** New page ▸ LaTeX document opens a split view, the source on the left and the document on the right, set as you type. Sections, lists, tables, footnotes, `\label` and `\ref`, and maths of every kind (`equation`, `align`, inline and display) are covered; a command it does not know is marked in the preview and listed, never an error that stops the page. A mistake points to its line. Export as `.tex` or as a PDF. It all runs on your computer, with no TeX installation needed.

**Focus.** `Ctrl+Shift+F` leaves only the page: no sidebar, no tabs, no Herman. Move the mouse to the top edge for the bars; press the keys again, or Esc when nothing is selected, to come back. From `Ctrl+K` you can also have it fade every block but the one you are writing in. `Ctrl+Alt+P` starts a pomodoro: 25 minutes of focus, then 5 of rest, a longer break every fourth time. It waits in the lower right corner, beside Herman, and asks before the next part begins. Settings → Pomodoro changes the times.

**Organise.** Databases with table, board, list, gallery, calendar and chart views. Show the same database in several pages, each with its own filters. A relation links rows to pages of another database (or of the same one), one way or both; a rollup sums up the linked pages: counts, totals, averages, the latest date. A Calculations view keeps the figures you work out from a database, such as `sum(Amount) / 12`. A formula property works out a value for each row from its other properties, like `prop("Price") * prop("Qty")`: the editor lists the functions and shows the result as you type, rows filter and sort by what it gives, and renaming a property never breaks it. Select rows in a table to change one property on all of them at once; rows you delete can be brought back in place with Undo. A view's search looks through every property it shows, not only the titles. Charts and other database blocks can sit side by side: choose "Place beside the previous block" from a block's menu.

**Start from a template.** New page ▸ From a template offers seven, made with care in English and Portuguese: personal finances (entries, categories with a monthly budget, accounts), home (chores, upkeep, inventory, services), a trip (day by day, bookings, packing, budget), a project, a library of books and films, studies, and a kitchen (recipes, the week's menu, the shopping list). Each comes with examples or empty, as you prefer, and is yours to change.

**Find.** `Ctrl+P` searches everything; `Ctrl+F` finds a word in the page in front of you, accents or not. `Ctrl+K` lists everything the app can do: type a few letters and press Enter. With text selected in a page, `Ctrl+K` adds a link instead. `Ctrl+/` shows every shortcut.

**Keep it tidy.** Archive a page you are done with: it leaves the sidebar, keeps its place, and is still found by search, marked Archived. Set any page, or Today, Tasks, Calendar or Meditations, as your home: the Home button and `Ctrl+Alt+H` take you there, and Settings → General can open it when sel starts. Every item of the sidebar can be moved or hidden in Settings → Sidebar, or with a right click; whatever is hidden is still a command away.

**Go back.** Every page keeps a version history. Compare, restore, or restore as a copy.

**Start the day.** Today shows your calendar, the tasks that are open and a phrase worth reading: Marcus Aurelius, the Dhammapada, Thoreau, or one of your own. Calendar shows the month, or the week hour by hour: your events and the tasks that are due, day by day. At the times you choose, Herman can brief you on the day, with a chime and, if you like, aloud.

**Keep tasks.** Tasks has a place of its own (`Ctrl+Alt+K`). Write a task the way you would say it, in English or Portuguese, and sel reads the date, the time, the priority, the project, the labels and how it repeats: "pay the card every 5th p1", "ligar pra mãe quinzenalmente". `Ctrl+Alt+A` adds one from anywhere in the app, and a shortcut for the whole system can be turned on. Tasks can have subtasks; a repeating task moves to its next date when you tick it. Todoist's CSV export can be imported.

**Be reminded.** A task with a time or a reminder, and the events of your calendar, a few minutes before they start, bring the window forward with a chime, or a notification when you are elsewhere; any of them can be snoozed for 10 minutes. Before a meeting, sel asks whether to record it, take notes only, or leave it. Settings → Notifications chooses what reminds you and how early. With the window closed nothing rings, unless sel stays in the tray.

**Keep a line a day.** Meditations holds one line for each day, a short paragraph at most. Today's can be rewritten until midnight; after that it stays as it was, and nothing in the app can change it. Under today's line, the same date in earlier years: "1 year ago you wrote…". Its days sync between your devices like any page. `Ctrl+Alt+N` opens it.

**Watch the sky.** Each day you write in Meditations lights a star. The stars of a month draw a figure, one at a time, and when the month ends the constellation gets its name, or the one you give it. Each year is a sky of its own, the twelve months in a wheel around the real moon of tonight. Finished tasks become dust in the Milky Way; a finished pomodoro, a ring around that day's star. Now and then a rare night: a meteor shower, an eclipse, a comet that stays a week. Nothing ever goes out, and there are no numbers. `Ctrl+Alt+G` opens it; Settings → Today turns it off.

**Close the day.** In the evening Herman may offer to close the day, or you can from the sidebar. One quiet screen, in four steps: what happened (the tasks you finished, the pages you wrote in), what is worth keeping (it becomes today's line in Meditations), up to three things for tomorrow (they wait at the top of Today in the morning), and the close: the window dims to the sky, today's star lights up, "Until tomorrow", with a soft bell, and any key brings it back. On the last day of a month you may name its constellation. No streaks, no scores. Settings → Today turns the bell off.

**Record meetings.** Record your microphone and what the computer plays while you take notes. The transcript is made on your own machine by whisper.cpp, and your Claude writes up the notes from it. The audio never leaves the computer.

**Ask.** Summarise, continue or rework text with your own Claude, through the Claude Code app on your machine. Nothing enters a page until you accept it.

**Meet Herman.** The assistant has a face: an old man drawn in a single line, who keeps a corner of the window. Ask him about a page or about your day. Now and then he says one short thing he noticed, written in advance and chosen on your computer, with no AI involved. Settings → Herman quiets him or sends him away.

**Let him build.** Herman reads more than the page in front of him: where it sits, what else you keep, your databases and how they are shaped, your day, and the pages that seem to bear on the question. Ask him for a page, a plan, a table or more rows and he proposes it; nothing is created until you press Apply.

**Ask his council.** Press Council and he first asks a few other voices (a skeptic, a strategist, a builder, an editor, a keeper), each answering from one point of view, then gives you one answer of his own with theirs above it. Each seat can run on a model of its own, or on another program you connect in Settings → Herman: Codex CLI, Gemini CLI, Ollama, or anything that reads a prompt and prints an answer.

**Sync.** Keep the same notes on several computers through a git repository you choose. With a password, everything is encrypted before it leaves; your calendars only ever travel encrypted. The look, your home and the sidebar's layout come along.

**Make it yours.** Zen is the default look. Every colour, font, size and radius can be changed in Settings → Appearance.

| | |
|---|---|
| ![Board view](docs/board.png) | ![Chart view, dark theme](docs/chart.png) |
| ![A page, dark theme](docs/page-dark.png) | ![Appearance settings](docs/appearance.png) |

## Principles

- **Yours.** Your notes are a SQLite file on your disk. No account, no server.
- **Still.** The app makes no network requests of its own, apart from loading images you link to, reading your calendar if you connect one, syncing with the repository you set up, downloading the transcription program and a speech model, once, when you ask for it, and asking GitHub for a new version, if you turn that on or press Check now.
- **Light.** One small window, a short list of dependencies.
- **Careful.** The interface runs sandboxed, and nothing you paste or import is trusted.

## Get it

Download the installer for Windows from [Releases](https://github.com/erik-sc/sel/releases). It is not code-signed, so Windows asks before running it the first time.

To hear of new versions, turn on Settings → General → Check for updates. sel then asks GitHub once a day, never while a meeting is recorded, and tells you when there is one. It downloads only when you say so, and installs when you restart or quit. Off, it asks nothing; Check now asks once.

To use your notes from Claude Desktop, Claude Code or another MCP app, turn on Settings → MCP → Connect other apps and copy the setup shown there. The app can then search and read your pages and databases, create pages, add to a page, and add or change database rows, but never delete anything. It talks to sel on this computer only, while sel is open; Settings lists which tools it called and when.

## Run it

You need [Node.js](https://nodejs.org) 24 or newer.

```bash
npm install
npm run dev
```

To build an unpacked app into `release/`:

```bash
npm run pack
```

## Work on it

```bash
npm test
npm run typecheck
```

CI runs both on every pull request.

The code is in `src/`:

- `main/` — the Electron main process: storage, files, version history, sync, AI, the briefing, tasks, alarms, meetings, Herman.
- `preload/` — the narrow bridge the interface is allowed to use.
- `renderer/` — the interface: editor, databases, shell, appearance, and a folder per screen.
- `shared/` — types and pure logic both sides agree on.

All style values live in one file, `src/renderer/src/styles/tokens.css`. Components only refer to them.

Plans for each release are in `docs/plans/`.

To try the update flow in development, serve a folder with a `latest.yml` on `http://127.0.0.1:<port>/` and start the app with `SEL_UPDATE_FEED` set to that address. An installed app ignores the variable.

## Releasing

A tag publishes a release. For version `0.6.0`:

1. Raise `version` in `package.json` to `0.6.0`, update this README with what changed, commit and merge it.
2. Tag that commit `v0.6.0` (a `v`, then the version exactly) and push the tag: `git tag v0.6.0 && git push origin v0.6.0`.

The Release workflow (`.github/workflows/release.yml`) checks that the tag and the version agree, runs the typecheck and the tests, builds the installer and publishes the release with `sel-0.6.0-setup.exe`, `sel-0.6.0-setup.exe.blockmap` and `latest.yml` attached. The in-app update check reads that last file, and only from the latest full release.

To build by hand, `npm run dist` writes the same three files into `release/` and uploads nothing.

sel 0.2.0 and earlier have no update check: install the first version that has one by hand.

## Keys

| | |
|---|---|
| `Ctrl+K` | Commands (a link, with text selected) |
| `Ctrl+/` | Every shortcut |
| `Ctrl+P` | Find |
| `Ctrl+F` | Find in this page |
| `Ctrl+N` | New page |
| `Ctrl+T` / `Ctrl+W` | New tab / close tab |
| `Ctrl+\` | Hide the sidebar |
| `Ctrl+Shift+F` | Focus mode |
| `Ctrl+J` | Herman, the assistant |
| `Ctrl+Alt+H` | Home |
| `Ctrl+Alt+T` | Today |
| `Ctrl+Alt+C` | Calendar |
| `Ctrl+Alt+K` | Tasks |
| `Ctrl+Alt+A` | Add a task |
| `Ctrl+Alt+N` | Meditations |
| `Ctrl+Alt+G` | The sky |
| `Ctrl+Alt+P` | Start a pomodoro |
| `Ctrl+Alt+M` | New meeting |
| `Ctrl+Shift+L` | Light / dark |
| `/` | Insert a block |

## License

[MIT](LICENSE)

---

*sel* is short for *selida*, Greek for *page*.
