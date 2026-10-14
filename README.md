# sel

A quiet place to write and keep things.

sel is a notes app for your desktop. Pages are made of blocks, databases are made of pages, and everything lives in one file on your computer.

![A page in sel, light theme](docs/page-light.png)

## What it does

**Write.** Headings, lists, to-dos, toggles, quotes, callouts, code and images. Type `/` for any block, or use Markdown shortcuts as you go.

**Organise.** Databases with table, board, list, gallery, calendar and chart views. Show the same database in several pages, each with its own filters.

**Find.** `Ctrl+P` searches everything; `Ctrl+F` finds a word in the page in front of you, accents or not.

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
- **Still.** The app makes no network requests of its own, apart from loading images you link to, reading your calendar if you connect one, and downloading the transcription program and a speech model, once, when you ask for it.
- **Light.** One small window, a short list of dependencies.
- **Careful.** The interface runs sandboxed, and nothing you paste or import is trusted.

## Get it

Download the installer for Windows from [Releases](https://github.com/erik-sc/sel/releases). It is not code-signed, so Windows asks before running it the first time.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer.

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

The code is in `src/`:

- `main/` — the Electron main process: storage, files, version history, AI, the briefing, meetings, Herman.
- `preload/` — the narrow bridge the interface is allowed to use.
- `renderer/` — the interface: editor, databases, shell, appearance.
- `shared/` — types both sides agree on.

All style values live in one file, `src/renderer/src/styles/tokens.css`. Components only refer to them.

## Keys

| | |
|---|---|
| `Ctrl+P` | Find |
| `Ctrl+F` | Find in this page |
| `Ctrl+N` | New page |
| `Ctrl+T` / `Ctrl+W` | New tab / close tab |
| `Ctrl+\` | Hide the sidebar |
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
