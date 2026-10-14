# sel

A quiet place to write and keep things.

sel is a notes app for your desktop. Pages are made of blocks, databases are made of pages, and everything lives in one file on your computer.

![A page in sel, light theme](docs/page-light.png)

## What it does

**Write.** Headings, lists, to-dos, toggles, quotes, callouts, code and images. Type `/` for any block, or use Markdown shortcuts as you go. The top bar keeps a quiet count of the page's words and reading time, or of what you have selected; Settings → General turns it off.

**Focus.** `Ctrl+Shift+F` leaves only the page: no sidebar, no tabs, no Herman. Move the mouse to the top edge for the bars; press the keys again, or Esc when nothing is selected, to come back. From `Ctrl+K` you can also have it fade every block but the one you are writing in.

**Organise.** Databases with table, board, list, gallery, calendar and chart views. Show the same database in several pages, each with its own filters. A relation links rows to pages of another database (or of the same one), one way or both; a rollup sums up the linked pages: counts, totals, averages, the latest date. A Calculations view keeps the figures you work out from a database, such as `sum(Amount) / 12`. Charts and other database blocks can sit side by side: choose "Place beside the previous block" from a block's menu.

**Find.** `Ctrl+P` searches everything; `Ctrl+F` finds a word in the page in front of you, accents or not. `Ctrl+K` lists everything the app can do: type a few letters and press Enter. With text selected in a page, `Ctrl+K` adds a link instead. `Ctrl+/` shows every shortcut.

**Go back.** Every page keeps a version history. Compare, restore, or restore as a copy.

**Start the day.** Today shows your calendar, the tasks that are open and a phrase worth reading: Marcus Aurelius, the Dhammapada, Thoreau, or one of your own. Calendar shows the month, or the week hour by hour: your events and the tasks that are due, day by day.

**Record meetings.** Record your microphone and what the computer plays while you take notes. The transcript is made on your own machine by whisper.cpp, and your Claude writes up the notes from it. The audio never leaves the computer.

**Ask.** Summarise, continue or rework text with your own Claude, through the Claude Code app on your machine. Nothing enters a page until you accept it.

**Meet Herman.** The assistant has a face: an old man drawn in a single line, who keeps a corner of the window. Ask him about a page or about your day. Now and then he says one short thing he noticed, written in advance and chosen on your computer, with no AI involved. Settings → Herman quiets him or sends him away.

**Let him build.** Herman reads more than the page in front of him: where it sits, what else you keep, your databases and how they are shaped, your day, and the pages that seem to bear on the question. Ask him for a page, a plan, a table or more rows and he proposes it; nothing is created until you press Apply.

**Ask his council.** Press Council and he first asks a few other voices (a skeptic, a strategist, a builder, an editor, a keeper), each answering from one point of view, then gives you one answer of his own with theirs above it. Each seat can run on a model of its own, or on another program you connect in Settings → Herman: Codex CLI, Gemini CLI, Ollama, or anything that reads a prompt and prints an answer.

**Make it yours.** Zen is the default look. Every colour, font, size and radius can be changed in Settings → Appearance.

| | |
|---|---|
| ![Board view](docs/board.png) | ![Chart view, dark theme](docs/chart.png) |
| ![A page, dark theme](docs/page-dark.png) | ![Appearance settings](docs/appearance.png) |

## Principles

- **Yours.** Your notes are a SQLite file on your disk. No account, no server.
- **Still.** The app makes no network requests of its own, apart from loading images you link to, reading your calendar if you connect one, downloading the transcription program and a speech model, once, when you ask for it, and asking GitHub for a new version, if you turn that on or press Check now.
- **Light.** One small window, a short list of dependencies.
- **Careful.** The interface runs sandboxed, and nothing you paste or import is trusted.

## Get it

Download the installer for Windows from [Releases](https://github.com/erik-sc/sel/releases). It is not code-signed, so Windows asks before running it the first time.

To hear of new versions, turn on Settings → General → Check for updates. sel then asks GitHub once a day, never while a meeting is recorded, and tells you when there is one. It downloads only when you say so, and installs when you restart or quit. Off, it asks nothing; Check now asks once.

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

- `main/` — the Electron main process: storage, files, version history, AI, the briefing, meetings, Herman.
- `preload/` — the narrow bridge the interface is allowed to use.
- `renderer/` — the interface: editor, databases, shell, appearance.
- `shared/` — types both sides agree on.

All style values live in one file, `src/renderer/src/styles/tokens.css`. Components only refer to them.

To try the update flow in development, serve a folder with a `latest.yml` on `http://127.0.0.1:<port>/` and start the app with `SEL_UPDATE_FEED` set to that address. An installed app ignores the variable.

## Releasing

The update check reads the project's GitHub Releases. For a version to reach installed apps:

1. Raise `version` in `package.json` (say `0.3.0`) and commit it.
2. Run `npm run dist`. It builds into `release/` and uploads nothing. Three files matter: `sel-0.3.0-setup.exe`, `sel-0.3.0-setup.exe.blockmap` and `latest.yml`.
3. On GitHub, create a release with the tag `v0.3.0` (a `v`, then the version exactly) and attach those three files.
4. Publish it as a full release, not a draft or a pre-release: the app only sees the latest published release.

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
| `Ctrl+Alt+T` | Today |
| `Ctrl+Alt+C` | Calendar |
| `Ctrl+Alt+M` | New meeting |
| `Ctrl+Shift+L` | Light / dark |
| `/` | Insert a block |

## License

[MIT](LICENSE)

---

*sel* is short for *selida*, Greek for *page*.
