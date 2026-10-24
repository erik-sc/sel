# A1a research: any block can sit beside another

Research for item A1a of `docs/plans/release-0.9.0.md` (lines 180-269). It was written in the
VETO phase on 2026-10-24 against `release/0.9.0` at fd6d6c5. Nothing in the repository changed
apart from this file. The experiments ran in a throwaway clone (`/tmp/a1a-research`) under
Node 24.22.1. **[verified]** means read in the code or run there. **[assumed]** means reasoned
but not run.

## 0. Findings that change or sharpen the plan

1. **Stale `beside` flags already exist in users' data, and A1a turns them into columns.** In
   0.8.0 nothing repairs a row (plan line 189). Here is one case. A database block B has
   `beside: true` next to database A. The user then deletes A, or drags B below a heading. B
   keeps the flag. Today B is drawn alone because the block before it is not a database. With
   the new predicate, B jumps into a row with that heading. This was run in the scratch test:
   `[db a, text t, db b(beside)]` gives `[[a],[t],[b]]` today and `[[a],[t,b]]` with A1a
   **[verified]**. Templates make this likely. In kitchen (`src/shared/templates/kitchen.ts:497-511`),
   "For busy days" is `beside` the "Favourites" view right under the "Recipes" heading. If the
   user deletes "Favourites", the next sel puts "For busy days" beside the heading. Nothing is
   lost, and the block menu's "Place below the previous block" fixes it. But it is a visible
   change on upgrade, and the plan does not list it. Options, cheapest first:
   - (a) Accept it and say so in the release notes. **My recommendation.**
   - (b) A database block with `beside` joins only a database before it. This keeps 0.8.0
     drawing for databases exactly, but it makes the rule lopsided: a text block may sit right
     of a database, while a database may not sit right of a text block. A1b's "left" drop and
     the `columns-beside-database` scenario then need care.
   - (c) An append-only data migration that clears `beside` on database blocks whose previous
     live sibling is not a database. The plan's principle "no migration" (line 20) rules this
     out without Érik.

   **Needs a lead decision. Option (c) needs Érik.**
2. **Every built-in template is unaffected.** A scratch test walked every template in en and
   pt-BR, on every block list at every level. It compared 0.8.0's `rowsOf` with the proposed
   predicate and found no difference **[verified]**. All six `beside` nodes follow a database
   node.
3. **"Top level" is not known to `layout.ts` today.** `Placed` is `Pick<Block, 'type' | 'props'>`
   (`src/renderer/src/editor/layout.ts:7`). The same `BlockList` component draws the page
   (`PageEditor.tsx:477`) and every block's children (`BlockView.tsx:187-190`), and so does the
   version viewer (`ReadOnlyBlocks.tsx:278`, called for children at `:342`, for roots at `:464`
   and `:514`). The new rule needs that context. Two ways to pass it:
   - a `top` argument to `canShareRow`, `rowsOf` and `besideChoice`, set by the caller;
   - or the parent's type (`'page'`) given to `rowsOf`.

   I prefer a `{ top: boolean }` option with `false` as the default, so existing calls keep the
   0.8.0 behaviour. The page root and a database row page are both `type: 'page'`, so "parent is
   a page" equals "top level". `menus.tsx:258-261` already has `only.parentId` and can read the
   parent's type.
4. **Copy and paste, and Duplicate, drop `beside` on non-database blocks.** `cleanProps` keeps
   `beside` only inside the `type === 'database'` branch (`src/renderer/src/editor/clipboard.ts:172-181`).
   `paste.duplicate` (`paste.ts:85`) goes through the same JSON. Pasting or duplicating a text
   row gives stacked blocks. Nothing is lost, but it looks unfinished. `clipboard.ts` is not in
   A1a's Touches. The lead should either add it (a one-line move of the `beside` check above the
   database branch, plus the existing test at `clipboard.test.ts:303`, which asserts the opposite
   and must flip), or list it under "Left for later".
5. **Scope and Design disagree about toggles.** Scope says `.blk-beside > .blk > .blk-children`
   loses its indent. Design says "a toggle's children keep their own indent inside the toggle".
   Follow Design: `.blk-beside > .blk:not(.blk-toggle) > .blk-children { padding-left: 0 }`. A
   bulleted or numbered list head with nested items will also lose the nested indent; the
   designer should look at that in `columns-two`.
6. **The hairlines cannot use `.blk::before` or `.blk::after`.** Those pseudo-elements already
   draw the drop lines (`editor.css:1135-1160`), and A1b adds side drop lines there. Draw the gap
   hairline on something else, for example `.blk-beside > .blk + .blk > .blk-row::after` placed
   at `left: -26px`. `.blk-row::before` is free except on quotes (`editor.css:671`).

## 1. How rows are stored and drawn today

- **Stored.** There is one optional prop, `BlockProps.beside?: boolean`
  (`src/shared/types.ts:104-105`, documented as "database: drawn in one row with the database
  block before it"). No table, column or setting holds layout. Main stores props as JSON and
  merges patches generically: `mergeProps` (`src/main/db/blocks.ts:121-132`) drops a key on
  `null` and has no per-type allow-list. `beside: true` on a text block is therefore accepted
  and stored today **[verified]**. Sync (`src/main/sync/format.ts:196-209`, `cleanProps` copies
  every key), backup and version snapshots carry props verbatim. Markdown export ignores the
  prop.
- **Writers of the flag.**
  - `ctrl.setBeside` (`controller.ts:393-396`) writes `true` or `null`.
  - Templates set it on database nodes only (`src/main/templates/instantiate.ts:245,254`).
  - Paste and Duplicate keep it for databases only (`clipboard.ts:180`).
  - Nothing else writes it. A `grep` for `beside` in `src/main` and `src/shared/actions.ts`
    finds nothing else, so persona Apply never sets it.
- **The rule.** All of it is in `src/renderer/src/editor/layout.ts` (46 lines, pure):
  - `MAX_BESIDE = 4` (`:5`).
  - `canShareRow`: `type === 'database'` (`:10-12`). **This is the only restriction.**
  - `sitsBeside`: both blocks can share a row and `props.beside === true` (`:15-17`).
  - `rowsOf` groups a sibling list greedily, up to 4 per row (`:23-31`).
  - `besideChoice` returns `'beside'`, `'below'` or `null` for the block menu (`:38-46`).
- **Drawing.**
  - Editor: `BlockList` (`BlockView.tsx:23-44`) wraps rows of 2 or more in
    `<div className="blk-beside">`. Children are drawn inside each `.blk`
    (`BlockView.tsx:187-190`). A row's columns therefore already contain their heads'
    children; only the indent and width differ.
  - Version viewer and AI preview: `BlockList` in `ReadOnlyBlocks.tsx:278-311` does the same.
    A reference entry (nested page or database) gets `props: {}`, so it never has `beside` there
    (`:293-297`).
  - CSS:
    - `.pe-page .pe-body > .blk-beside` gives every row the database width (`editor.css:750-760`).
    - `.blk-beside` is `flex; flex-wrap: wrap; column-gap: 52px` (`:766-770`).
    - Each column has `flex: 1 1 0; min-width: min(100%, 240px)` (`:772-775`).
    - Children are indented by `.blk-children { padding-left: var(--indent) }` (`:431-433`),
      where `--indent` is 26px (`tokens.css:83`).
    - `--page-width` is 560px (`tokens.css:73`) and `--database-width` is 880px (`tokens.css:76`).
  - The version viewer has no `.pe-page`, so its rows stay at text width today
    (`versions.css:398-408`).
- **The menu.** `menus.tsx:257-274` builds `siblings` from the parent's `content` (trashed
  blocks filtered out) and calls `besideChoice`. When the result is set, it adds the entry
  "Place beside the previous block" or "Place below the previous block" with the `Columns` icon.
  The comment at `:257` says "A single database block".
- **Other readers of the flag.** `versions/diff.ts:389-392` labels a change of `beside` on any
  block ("Place: Beside the block before"), so it needs no change. `clipboard.ts:180` is covered
  in finding 4.

## 2. Minimal change set

| File | Change |
|---|---|
| `editor/layout.ts` | `Placed` gains nothing. `canShareRow(block, top = false)` returns `type === 'database' \|\| (top && type !== 'page')`. `sitsBeside`, `rowsOf(blocks, { top })` and `besideChoice(blocks, id, { top })` pass it through. New pure `rowWidth(row): 'text' \| 'wide'`: wide when `row.length >= 3` or any block is a database. New pure `rowRepairOps(ops, get): Op[]` (§3). |
| `editor/layout.test.ts` | Cases listed in §5. The existing `canShareRow(block('a','text',true))` is still false without `top`. |
| `editor/BlockView.tsx` | `BlockList` derives `top` itself: `getBlock(blocks[0]?.parentId)?.type === 'page'`, read through the store. This keeps `PageEditor.tsx`, which is not in Touches, unchanged. The alternative is a `top` prop set at `PageEditor.tsx:477`. A row div gets `className={\`blk-beside${rowWidth(row) === 'wide' ? ' is-wide' : ''}\`}`, `role="group"` and `aria-label={copy.columns(row.length)}`. Update the comment at `:30`. |
| `editor/menus.tsx` | Pass `{ top: getBlock(only.parentId)?.type === 'page' }` to `besideChoice` (`:261`). Labels come from `useEditorCopy()`. Update the comment at `:257`. |
| `editor/controller.ts` | `commit()` (`:200-211`) appends `rowRepairOps(ops, getBlock)` before `invertOps`, so undo and redo carry the repair as one step. `setBeside` (`:394-396`) announces "Placed beside" or "Placed below". |
| `editor/copy.ts` (new) | `EditorCopy { placeBeside, placeBelow, placedBeside, placedBelow, columns(n) }` in en and pt-BR, with `useEditorCopy()` and `editorCopy()` read from `useHome` locale, in the same shape as `a11y/announce.ts:37-41` and `database/dateCopy.ts`. |
| `editor/editor.css` | Narrow the wide rule to `.pe-page .pe-body > .blk-beside.is-wide` (`:755`). A 2-text row keeps 100% of the text column. Add `align-items: flex-start` (`:766`). Columns get `min-width: min(100%, var(--column-min))` with `.blk-beside > .blk-database` keeping 240px. Add `.blk-beside > .blk:not(.blk-toggle) > .blk-children { padding-left: 0 }`. Add the hairline on `:hover` and `:focus-within` (finding 6). |
| `versions/ReadOnlyBlocks.tsx` | `BlockList` gets `top` from its callers: `:464` and `:514` pass true, `:342` passes false. Same class, role and label. Without `.pe-page`, the width rule needs `.vh-doc .pe-body > .blk-beside.is-wide` to show "same widths" (Design, line 264). That selector lives in `versions.css`, which is **not in Touches**: add it, or accept text width in the viewer. |
| `styles/tokens.css` | `--column-min: 160px` next to `--page-width` (`:73-83`). |
| `e2e/screens/scenarios/columns.ts` (new) | Five scenarios (plan line 240). They depend on S0. |
| `docs/codebase-knowledge/` | `10-glossary.md` and `20-architecture.md`, if they describe rows as database-only. |

Copy check: "Place beside the previous block" / "Colocar ao lado do bloco anterior" and the
other three strings are as in the plan. The group label "{n} columns" / "{n} colunas" is from
Design. The rest of the block menu stays English (a known risk in plan line 754).

## 3. Row repair: a precise rule

The plan's sentence (lines 206-210) leaves edge cases open. A rule that passes every "Done when"
case and does not fight A1b:

> After applying `ops` on an `Overlay` (`editor/ops.ts:13`, already pure and used by
> `invertOps`), for every block B that is live, has `beside: true`, and whose `beside` is
> **not** set by an `update` op in this same batch (so A1b's side drops and `setBeside` are
> never undone by the repair):
> - if B is no longer top level and is not a database: clear `beside`;
> - otherwise, if B's previous live sibling changed **and** the new previous sibling was not in
>   B's row before the batch: clear `beside`.

"Live" means present in the overlay and not trashed. `Overlay.apply` only sets `trashedAt` on
pages and databases (`ops.ts:80-87`), so `trashedAt` must count as gone. Results:

| Case | Before | After the batch | Repair |
|---|---|---|---|
| Head deleted | `[H, X·, Y·]` | X's previous is outside the row | clear X → `[X, Y·]` |
| Head moved elsewhere | same | same as above | clear X |
| Head indented (into the block above) | same | X's previous changes | clear X. H is now a child; if H had `beside` and is not a database, clear H |
| Middle deleted | `[H, X·, Y·]` | Y's previous is H, which was in the row | none |
| Last deleted | `[H, X·]` | nobody's previous changed | none |
| Block with `beside` dragged elsewhere | X· moved after Z | X's previous is Z, not in the old row | clear X |
| New block inserted between heads (Enter, A1c) | `[H, X·]` + N after H | X's previous is N, not in the old row | clear X → `[H] [N] [X]`. A1c then changes Enter so this does not happen inside a row |

- **Cost.** `commit` runs on every text flush. Return `[]` at once when every op is an `update`
  without `patch.type`. Then typing pays nothing.
- **What the repair does not cover.** Sync merges, persona Apply, Markdown import, and edits
  from main all bypass `ctrl.commit`. The plan accepts this (Risks, line 747).

## 4. Data compatibility (rule 3)

- **Stored format: unchanged.** The schema, migrations, `sync/format.ts`, backup and export are
  untouched. The only data written is `props.beside: true | null` on more block types, through
  the existing `update` op, which main already accepts for any type **[verified]**
  (`mergeProps`). No migration is needed. Rule 3 is not triggered by the plan as written.
- **0.9.0 data read by 0.8.0:** same blocks, same order, text rows drawn stacked. `rowsOf` never
  reorders, so the order check is trivially true. The old 0.8.0 block menu offers no entry for a
  text block (`besideChoice` returns `null`), so the flag stays invisible there and returns
  as a column on the next upgrade. That is harmless.
- **0.8.0 data read by 0.9.0:** see finding 1. Stale database flags can form new rows. Option
  (c) there would be a migration and needs Érik.
- **Sync between a 0.8.0 and a 0.9.0 device:** props travel verbatim. The 0.8.0 device draws
  stacked blocks and the 0.9.0 device draws columns. There is no conflict, because the flag is
  just a prop.

## 5. Test plan (maps to "Done when", lines 227-244)

- `layout.test.ts` (pure):
  - two text blocks, the second `beside`, form one row with `top`;
  - the same without `top` gives two rows (nested text never joins);
  - a `page` block never joins, even with `top`;
  - databases still join at any level;
  - a fifth block starts a new row;
  - `besideChoice` for a text block gives `'beside'`, `'below'` and `null` (row full);
  - `rowWidth` gives text for 2 text blocks, wide for 3 text blocks, wide for text + database;
  - `rowRepairOps` covers every row of the §3 table, the five the plan names plus "dragged
    elsewhere" and "explicit `setBeside` in the batch is kept". Each is undone by its inverse
    (reuse the `applyAndUndo` pattern of `structure.test.ts`).
  - 0.8.0 compatibility: copy the old one-line `canShareRow` into the test, run old and new
    `rowsOf` over the same new data, and assert `rows.flat()` is equal. This is the plan's test.
    Add the stale-flag case as a documented expectation, whatever finding 1 decides.
- **Happy-dom, editor.** There is no editor component test today. It is feasible:
  - `putBlocks` (`store/blocks`, as `review/TodayWeek.test.tsx:33` does);
  - an `EditorController` inside `EditorContext.Provider`;
  - render `BlockList` for a page with a text head with 2 children, beside a callout;
  - expect one `.blk-beside[role=group][aria-label="2 columns"]` with 2 `.blk` children, the
    first holding a `.blk-children` with 2 blocks;
  - no database, so the lazy `DatabaseView` is avoided **[assumed]**.
- **Happy-dom, version viewer.** Render `SnapshotBlocks` (`ReadOnlyBlocks.tsx:458-465`, pure
  props) with the same content and expect the same group. This is the easy test for "the
  version viewer draws the same rows".
- **Width class.** The `rowWidth` pure test, plus `.is-wide` checked in one of the happy-dom
  renders.
- **axe** on the happy-dom render (`a11y/axe.test.tsx` pattern): checks the group role and its
  label.
- **Screens.** `columns-two`, `columns-four`, `columns-beside-database`, `block-menu-beside` and
  `block-menu-beside-pt` once S0 is merged. Before that they go in the PR as text (plan
  Risks, line 732).

## 6. Risks

- **Finding 1 (stale flags).** This is the only visible effect on existing pages. Decide before
  building.
- **Typing breaks rows until A1c lands.** Enter at the end of a head inserts a sibling. The
  repair then splits the row (`[H] [N] [X]`). That is correct but surprising. A1a alone should
  not ship in a release without A1c. They are in the same release, waves 1 and 3.
- **The repair inside `commit`** touches every structural edit. A wrong rule silently clears
  flags. Keep it pure, test the table, and short-circuit for text-only batches.
- **CSS width** depends on `.pe-page` container queries (`editor.css:26-29`). A 2-column text
  row must not get `.is-wide`, or the page jumps when a second block is placed (Design).
- **The version viewer width** needs `versions.css`, outside Touches (§2).
- **Keyboard order** stays document order (`structure.ts:56` `order`). This matches Design;
  A1c only changes Enter, Backspace and Tab.
- **Children without indent.** Nested list items in a column lose their visual nesting. This is
  a designer call.
