# Flow: importing from Notion or Obsidian, and exporting as a zip

Since 0.8.0 (F1, F2). Feature `transfer`: contract src/shared/transfer.ts, words
src/shared/transferCopy.ts (en, pt-BR, the language of backups), main src/main/transfer/,
renderer src/renderer/src/transfer/. No dependency was added: the zip reader and writer are
src/main/transfer/zip.ts on node:zlib.

## Import

Trigger: Settings → General → Data ("Notion zip…", "Obsidian folder…",
src/renderer/src/transfer/TransferSettings.tsx) or the palette ("Import from Notion…",
registered in src/renderer/src/transfer/gate.ts). Both call `chooseImport` — src/renderer/src/transfer/gate.ts:55

1. `transfer:pickImport` opens the native dialog (a zip for Notion, a folder for Obsidian; a zip
   is accepted for either) — src/main/transfer/register.ts:76
2. The files are listed, not read: `zipSource` (central directory only, entries read on demand,
   Notion's zip-of-zips opened, one wrapping folder dropped) or `folderSource` (hidden folders
   such as `.obsidian` skipped, no links followed) — src/main/transfer/source.ts
3. `planImport` reads the Markdown and CSV and builds the tree — src/main/transfer/plan.ts:128:
   `Page.md` + folder `Page/` is a page and its sub-pages; `Table.csv` (Notion's `_all.csv` first)
   is a database whose columns get types from their values (src/main/transfer/columns.ts,
   `csvToDatabase`), and folder `Table/` holds row pages matched to rows by title; a folder with
   Markdown but no page of its name is a page; everything else is an attachment. Notion's 32-hex
   ids are dropped from titles.
4. Every page gets its id now; then each text is rewritten (`rewrite`, src/main/transfer/plan.ts:468):
   `[[wikilinks]]` (by name, path, alias, heading), `![[embeds]]`, relative Markdown links and
   notion.so addresses of exported pages become `sel://page/<id>` links; images become
   `sel-import:<n>` placeholders; a PDF or a missing file stays as its name (`skipped`), a link to a
   page not in the import stays as text (`unresolved`). Code fences and inline code are left alone.
   Front matter: an emoji `icon` becomes the page icon, other keys are listed at the top.
5. The plan stays in main under a token (30 minutes); the window gets only the counts and shows
   them (src/renderer/src/transfer/ImportDialog.tsx).
6. "Import" → `transfer:runImport` → `runImport` — src/main/transfer/run.ts:66: one page
   "Imported on <day>" at the end of the workspace, then the images (`storeImage`, sniffed like
   any image), then each page or database in its own `createTree` with the ids from the plan
   (`TreeInput.id`, src/main/db/repository.ts:1041), with a `setImmediate` between them and
   progress on `transfer:progress`. A sub-page goes where its parent's text had a line linking
   to it (`linkedChild`, src/main/transfer/run.ts:48), else at the end. On failure the
   import's page goes to the trash (src/main/transfer/run.ts:152).
7. "Undo import" → `transfer:undoImport` trashes that page; only pages imported since sel
   started are accepted — src/main/transfer/register.ts:132

## Export as a zip

Trigger: Settings → Data "Save zip…", or the palette ("Export everything as a zip…", "Export this
page and its sub-pages as a zip…").

1. `transfer:exportZip` asks where to save — src/main/transfer/register.ts:138
2. `planExport(repo, { zip, rootId })` — src/main/data/exportAll.ts:89 — is the folder export's plan
   with three additions: a database the page holds is a link line, not a table
   (`MarkdownOptions.databaseLinks`, src/main/markdown.ts:247); each database also as
   `Name.csv` (`databaseCsv`, src/main/data/exportAll.ts:73, cells written so they read back as
   the same type); and `index.md`, every page in order, marked `sel-export: index` so an import
   leaves it out and uses its order.
3. `exportZip` writes it with `ZipWriter` under `<name>.partial`, renamed when complete —
   src/main/transfer/exportZip.ts:23

Round trip (src/main/transfer/roundtrip.test.ts): export, then import as Obsidian, gives the same
titles, nesting, order, links, database columns and values.

## Known limits

- Only raster images are kept (sel stores nothing else); other attachments stay as names.
- Without Zip64 when writing: 65535 entries / 4 GB per zip. Reading supports Zip64.
- Planning the export is synchronous, like the folder export; writing it yields.
- A linked database view is exported as its table, and comes back as a copy (a new database).
- Relations, rollups and formulas are exported as text and come back as text.
