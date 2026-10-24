# Screens

Screenshots of the real app for pull requests. A PR lists what to capture in a `screens` block
in its body; the Screens workflow (`.github/workflows/screens.yml`) builds the PR's head and its
merge base on Windows, captures each scenario in light and dark on both, and posts one comment
on the PR with the pairs side by side (before on the left), edited on every push.

````
```screens
tasks-board: the board grouped by priority
page-notes: the demo notes page
```
````

One scenario per line, `<id>: <free text>` (only the id is read). `all` captures every scenario.
Without a block nothing runs. Editing the PR body re-runs the capture only when the block's ids
changed. An unknown id turns the job red, after the known ones were captured.

One comment shows at most 200 images (`MAX_IMAGES`, the same in comment.ts and in the publish
job): 50 scenarios in both themes. Beyond that, cells say "cut" and the comment says how many.

The images are committed to the orphan branch `team/screens` under `pr-<n>/<sha7>/`; the run's
artifact also holds them, with `manifest.json`, `comment.md` and, in `failed/`, what the window
showed when a capture failed.

## Adding a scenario

Add an entry to the file of its area in `scenarios/` (or a new file there: every file is
loaded, there is no index):

```ts
{
  id: 'tasks-board',                 // kebab-case, unique across files
  description: 'The Tasks database as a board grouped by priority',
  locale: 'pt-BR',                   // optional, default 'en'
  themes: ['dark'],                  // optional, default both
  workspace: (repo, now) => { … },   // optional: adds to the demo workspace (seed.ts)
  run: async (page) => { … }         // drives the window, as a user would, to what to capture
}
```

`run` starts on the open app (the Today screen, one tab) and uses the UI: clicks, keys, the
palette. Find things by role and name (`ui.ts` has the common steps) and wait for what should be
on screen before returning; the capture is the whole window at 1280×800 once `run` returns. A
`run` that fails on base is shown as "not in base" (the feature is new); one that fails on head
is a failure.

The demo workspace (`seed.ts`) is the same on both sides: a Notes page, a Projects page with two
sub-pages, and the Tasks database with 12 tasks dated around the run's day and the views All
tasks, By project, By priority and Calendar. Base is seeded with base's own `Repository`.

## Running it locally

The pure parts (block parser, registry, seed, comment) need only Node 24:

```sh
npm run screens:test        # vitest run --dir e2e
```

Captures need the app built and Electron downloaded. On Linux they run under Xvfb:

```sh
npm ci --ignore-scripts && node node_modules/electron/install.js && npm run build
SCREENS_IDS="tasks-board page-notes" xvfb-run -a -s "-screen 0 1600x1000x24" npm run screens
```

The PNGs land in `e2e/screens/.output/png/`. Set `SCREENS_BASE_DIR` to another built checkout
to capture a base side too. Local captures are for trying a scenario out: fonts and window
chrome differ from Windows, so the pictures of record are the workflow's.
