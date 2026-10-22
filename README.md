# sel

A quiet place to write and keep things.

sel is a notes app for your desktop. Pages are made of blocks, databases are made of pages, and everything lives in one file on your computer.

**[erik-sc.github.io/sel](https://erik-sc.github.io/sel/)** · [Download for Windows](https://github.com/erik-sc/sel/releases/latest)

![A page in sel: a release plan with a callout, to-dos, an equation and code](docs/screens/page.webp)

## What it does

### Write

**Write.** Headings, lists, to-dos, toggles, quotes, callouts, code, images and equations. Type `/` for any block (in English or Portuguese: `/titulo`, `/tarefa` and `/citação` work too), or use Markdown shortcuts as you go; `$$` starts an equation. Paste from a web page, Google Docs or an e-mail and the headings, lists, quotes, links and bold come along; images from the web stay behind, and nothing pasted is trusted. Pasted Markdown keeps its nested lists. The top bar keeps a quiet count of the page's words and reading time, or of what you have selected; Settings → General turns it off.

**Write LaTeX.** New page ▸ LaTeX document opens a split view, the source on the left and the document on the right, set as you type. Sections, lists, tables, footnotes, `\label` and `\ref`, and maths of every kind (`equation`, `align`, inline and display) are covered; a command it does not know is marked in the preview and listed, never an error that stops the page. A mistake points to its line. Export as `.tex` or as a PDF. It all runs on your computer, with no TeX installation needed.

**Focus.** `Ctrl+Shift+F` leaves only the page: no sidebar, no tabs, no Herman. Move the mouse to the top edge for the bars; press the keys again, or Esc when nothing is selected, to come back. From `Ctrl+K` you can also have it fade every block but the one you are writing in. `Ctrl+Alt+P` starts a pomodoro: 25 minutes of focus, then 5 of rest, a longer break every fourth time. It waits in the lower right corner, beside Herman, and asks before the next part begins. Settings → Pomodoro changes the times.

| | |
|---|---|
| ![Typing / on an empty line lists every block, with the writing tools first](docs/screens/blocks.webp) | ![A LaTeX document: the source on the left, the typeset page on the right](docs/screens/latex.webp) |
| ![Focus mode: only the page](docs/screens/focus.webp) | ![A pomodoro waiting in the lower right corner](docs/screens/pomodoro.webp) |

### Organise

**Organise.** Databases with table, board, list, gallery, calendar and chart views. Show the same database in several pages, each with its own filters. A relation links rows to pages of another database (or of the same one), one way or both; a rollup sums up the linked pages: counts, totals, averages, the latest date, of all of them or only those of a period ("this month", "last month") or an option. A Calculations view keeps the figures you work out from a database, such as `sum(Amount) / 12`, and they can read rollups and formulas; split by a select property, it becomes a small table with one row per option and a total, such as planned and actual spending per budget group with what is left of the salary. A formula property works out a value for each row from its other properties, like `prop("Price") * prop("Qty")`: the editor lists the functions and shows the result as you type, rows filter and sort by what it gives, and renaming a property never breaks it. Select rows in a table to change one property on all of them at once; rows you delete can be brought back in place with Undo. A view's search looks through every property it shows, not only the titles. A chart can group rows by a relation, a rollup or a formula and add up a formula, such as spending by category. Charts and other database blocks can sit side by side: choose "Place beside the previous block" from a block's menu.

**Start from a template.** New page ▸ From a template offers seven, made with care in English and Portuguese: personal finances (your take-home pay and a plan that says what to look at, entries, this month's budget per category next to last month, accounts), home (chores, upkeep, inventory, services), a trip (day by day, bookings, packing, budget), a project, a library of books and films, studies, and a kitchen (recipes, the week's menu, the shopping list). Each comes with examples or empty, as you prefer, and is yours to change.

| | |
|---|---|
| ![The finances template: the month so far, last month, spending by category and money in and out by month](docs/screens/finances.webp) | ![This month's budget: each category's budget, what has gone out and what is left](docs/screens/budget.webp) |
| ![A project board grouped by status](docs/screens/board.webp) | ![A library: a board of what to read next, and charts of what stayed](docs/screens/charts.webp) |
| ![The kitchen: the week's menu linked to recipes, and a shopping list by aisle](docs/screens/relations.webp) | ![Recipes as a gallery, and a quick list beside it](docs/screens/gallery.webp) |

![The template gallery: seven templates with a preview of what each one makes](docs/screens/templates.webp)

### Find and go back

**Find.** `Ctrl+P` searches everything, one line per page, titles first; `Ctrl+F` finds a word in the page in front of you, accents or not. `Ctrl+K` lists everything the app can do: type a few letters and press Enter. With text selected in a page, `Ctrl+K` adds a link instead. The link field also finds pages: type a few letters of one to link to it. At the foot of a page, "Linked from" lists the pages that link to it. `Ctrl+/` shows every shortcut.

**Keep it tidy.** Archive a page you are done with: it leaves the sidebar, keeps its place, and is still found by search, marked Archived. Set any page, or Today, Tasks, Calendar or Meditations, as your home: the Home button and `Ctrl+Alt+H` take you there, and Settings → General can open it when sel starts. Every item of the sidebar can be moved or hidden in Settings → Sidebar, or with a right click; whatever is hidden is still a command away. A page or a screen opens in one tab only: opening it again, from anywhere, takes you to the tab that already shows it. When tabs no longer fit, the bar scrolls and ⌄ lists them all.

**Go back.** Every page keeps a version history. Compare, restore, or restore as a copy.

**Keep it safe.** Once a day sel makes a copy of your notes and checks that it opens before keeping it; the last few days and weeks are kept. Settings → General → Data restores one, after saving the present state first. If the notes file is ever damaged, sel offers the latest good copy when it starts, and never deletes the damaged file. The same place exports everything as Markdown: a file per page, sub-pages in folders, images alongside, links between pages that still work.

| | |
|---|---|
| ![Ctrl+K: every command, found by a few letters](docs/screens/commands.webp) | ![Ctrl+P: search across pages and tasks](docs/screens/search.webp) |
| ![Version history, with the changes since that version marked](docs/screens/history.webp) | ![Ctrl+/: every shortcut](docs/screens/shortcuts.webp) |

### Your days

**Start the day.** Today shows your calendar, the tasks that are open and a phrase worth reading: Marcus Aurelius, the Dhammapada, Thoreau, or one of your own. Calendar shows the month, or the week hour by hour: your events and the tasks that are due, day by day. To connect a calendar, paste its secret iCal address in Settings → Today: Google Calendar, Outlook, iCloud, Fastmail and anything else that publishes an `.ics` address work. The address stays in the main process and never reaches the window. At the times you choose, Herman can brief you on the day, with a chime and, if you like, aloud.

**Keep tasks.** Tasks has a place of its own (`Ctrl+Alt+K`). Write a task the way you would say it, in English or Portuguese, and sel reads the date, the time, the priority, the project, the labels and how it repeats: "pay the card every 5th p1", "ligar pra mãe quinzenalmente". `Ctrl+Alt+A` adds one from anywhere in the app, and a shortcut for the whole system can be turned on. Tasks can have subtasks; a repeating task moves to its next date when you tick it. Todoist's CSV export can be imported.

**Edit them where they are.** On Today, in the Inbox, in Tasks and on the Calendar, a task shows its date, priority, project and labels as small chips: click one to change it. Click the task for a panel with everything, its notes and subtasks; F2 renames it, and the keys D, R, 1–4, # and @ set the date, the repeat, the priority, the project and the labels. A date can be written ("sex 15h", "daqui 3 dias", "next monday") or picked from Today, Tomorrow, Weekend or Next week. Repeats are chosen from every day, weekdays, every week, month or year, or your own rule, and read back in words. On the Calendar, drag a task to another day or hour; click an empty one to add a task there.

**Capture now, refine later.** Write a task down as it comes and leave it in the Inbox. Until it has a date, a priority and a project, it shows what is missing and waits in To refine. Refine walks through them one at a time, by keyboard. sel reminds you: a line in your briefing, a word from Herman when something has waited two days, a refine time on weekdays at 17:00, and a quiet dot on Tasks in the sidebar. Each one can be turned off in Settings → Notifications.

**Be reminded.** A task with a time or a reminder, and the events of your calendar, a few minutes before they start, bring the window forward with a chime, or a notification when you are elsewhere; any of them can be snoozed for 10 minutes. Before a meeting, sel asks whether to record it, take notes only, or leave it. Settings → Notifications chooses what reminds you and how early. With the window closed nothing rings, unless sel stays in the tray.

| | |
|---|---|
| ![Today: a phrase from Herman, the agenda from your calendar, and the open tasks](docs/screens/today.webp) | ![The calendar week, hour by hour, with the tasks that are due](docs/screens/calendar-week.webp) |
| ![A task written in plain words, with the repeat, time, priority and project it was read as](docs/screens/tasks.webp) | ![Tasks by project](docs/screens/tasks-board.webp) |

### A line a day

**Keep a line a day.** Meditations holds one line for each day, a short paragraph at most. Today's can be rewritten until midnight; after that it stays as it was, and nothing in the app can change it. Under today's line, the same date in earlier years: "1 year ago you wrote…". Its days sync between your devices like any page. `Ctrl+Alt+N` opens it.

**Watch the sky.** Each day you write in Meditations lights a star. The stars of a month draw a figure, one at a time, and when the month ends the constellation gets its name, or the one you give it. Each year is a sky of its own, the twelve months in a wheel around the real moon of tonight. Finished tasks become dust in the Milky Way; a finished pomodoro, a ring around that day's star. Now and then a rare night: a meteor shower, an eclipse, a comet that stays a week. Nothing ever goes out, and there are no numbers. It is drawn in pixels, like Herman: hover a month's name and its constellation turns in 3D. `Ctrl+Alt+G` opens it; Settings → Today turns it off.

**Close the day.** In the evening Herman may offer to close the day, or you can from the sidebar. One quiet screen, in four steps: what happened (the tasks you finished, the pages you wrote in), what is worth keeping (it becomes today's line in Meditations), up to three things for tomorrow (they wait at the top of Today in the morning), and the close: the window dims to the sky, today's star lights up, Herman falls asleep on his hill under tonight's moon, "Until tomorrow", with a soft bell, and any key brings it back. On the last day of a month you may name its constellation. No streaks, no scores. Settings → Today turns the bell off.

| | |
|---|---|
| ![Meditations: today's line, and what you wrote on this day in earlier years](docs/screens/meditations.webp) | ![The sky: last month's constellation, named, and the moon of tonight](docs/screens/sky.webp) |
| ![Close the day: what happened, what is worth keeping, tomorrow, the close](docs/screens/close-day.webp) | ![The calendar month, with events and the tasks that are due](docs/screens/calendar.webp) |

### Herman, and meetings

**Meet Herman.** The assistant has a face: an old man in 64 pixels, who keeps a corner of the window and has twelve outfits to choose from in Settings → Herman. Ask him about a page or about your day. Now and then he says one short thing he noticed, written in advance and chosen on your computer, with no AI involved. Settings → Herman quiets him or sends him away.

**Let him build.** Herman reads more than the page in front of him: where it sits, what else you keep, your databases and how they are shaped, your day, and the pages that seem to bear on the question. Ask him for a page, a plan, a table or more rows and he proposes it; nothing is created until you press Apply.

**Ask his council.** Press Council and he first asks a few other voices (a skeptic, a strategist, a builder, an editor, a keeper), each answering from one point of view, then gives you one answer of his own with theirs above it. Each seat can run on a model of its own, or on another program you connect in Settings → Herman: Codex CLI, Gemini CLI, Ollama, or anything that reads a prompt and prints an answer.

**Ask.** Summarise, continue or rework text with your own Claude, through the Claude Code app on your machine. Nothing enters a page until you accept it.

**Record meetings.** Record your microphone and what the computer plays while you take notes. The transcript is made on your own machine by whisper.cpp, and your Claude writes up the notes from it. Playing the recording back marks the paragraph being heard. A meeting made from a calendar event lists who was invited. The audio never leaves the computer.

| | |
|---|---|
| ![Herman answers a question about the page](docs/screens/herman.webp) | ![The council: what the Skeptic and the Builder said, then one answer from Herman](docs/screens/council.webp) |
| ![Herman proposes a page; nothing is made until Apply](docs/screens/herman-apply.webp) | ![A meeting page: its details, the recorder and the notes](docs/screens/meeting.webp) |

### Sync and settings

**Sync.** Keep the same notes on several computers through a git repository you choose. With a password, everything is encrypted before it leaves; your calendars only ever travel encrypted. Your home and the sidebar's layout come along.

**Say what's wrong.** Report a bug or suggest a feature from the sidebar, the Help menu or `Ctrl+K`. It is kept as a file on your computer, where you can follow it as it is taken up, reviewed and done, or withdraw it. You can attach the last lines of sel's own log, after seeing them. The app sends nothing; a nightly development run reads the folder and opens a pull request for what it can fix.

**One look.** Paper and ink, light or dark: square corners, a printed frame on menus and dialogs, a grid of dots behind the sidebar, Newsreader for your words and IBM Plex Mono for the app's, both shipped with it. Herman and the sky are drawn in the same inks. Settings → General picks light, dark or the system's. Everything can be reached from the keyboard, and the zoom you choose is kept.

| | |
|---|---|
| ![A page in the light theme](docs/screens/page.webp) | ![A page in the dark theme](docs/screens/page-dark.webp) |
| ![Settings → Sync: a git repository of your own, encrypted if you like](docs/screens/settings-sync.webp) | ![Report a bug or suggest a feature](docs/screens/feedback.webp) |
| ![Settings → Herman](docs/screens/settings-herman.webp) | ![Settings → Notifications](docs/screens/settings-notifications.webp) |

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
npm run lint
```

CI runs all three on every pull request, and audits what ships.

The code is in `src/`:

- `main/` — the Electron main process: storage, files, version history, sync, AI, the briefing, tasks, alarms, meetings, Herman.
- `preload/` — the narrow bridge the interface is allowed to use.
- `renderer/` — the interface: editor, databases, shell, and a folder per screen.
- `shared/` — types and pure logic both sides agree on.

Colours, fonts, shadows and radii live in one file, `src/renderer/src/styles/tokens.css`; layout keeps its own measures.

A feature lives in its own folder and adds one line to each feature list; "Adicionar uma feature" in `docs/codebase-knowledge/50-conventions.md` says how.

The installer has Electron's fuses set (see `electron-builder.yml`); the interface runs sandboxed. When something fails, sel says so and writes it to `logs/sel.log` in its data folder (the Data settings open its folder); the log keeps the shape of the failure, never your text.

Plans for each release are in `docs/plans/`.

The website is in `site/`: one static page in English and Portuguese, with no build step and nothing loaded from elsewhere. Open `site/index.html` in a browser to see it. The Pages workflow (`.github/workflows/pages.yml`) publishes it, with the screenshots from `docs/screens/`, whenever either changes on `main`.

To try the update flow in development, serve a folder with a `latest.yml` on `http://127.0.0.1:<port>/` and start the app with `SEL_UPDATE_FEED` set to that address. An installed app ignores the variable.

## Releasing

A tag publishes a release. For version `0.7.0`:

1. Raise `version` in `package.json` to `0.7.0`, update this README with what changed, commit and merge it.
2. Tag that commit `v0.7.0` (a `v`, then the version exactly) and push the tag: `git tag v0.7.0 && git push origin v0.7.0`.

The Release workflow (`.github/workflows/release.yml`) checks that the tag and the version agree, runs the typecheck and the tests, builds the installer and publishes the release with `sel-0.7.0-setup.exe`, `sel-0.7.0-setup.exe.blockmap` and `latest.yml` attached. The in-app update check reads that last file, and only from the latest full release.

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
