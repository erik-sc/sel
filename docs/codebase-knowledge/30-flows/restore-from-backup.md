# Flow: restore from a backup (guided, 0.8.0 F3)

Trigger: Settings → General → Data → "Restore a backup" → "Choose backup…" (src/renderer/src/backup/DataSettings.tsx:81 renders `RestoreRow`, src/renderer/src/backup/RestoreFlow.tsx:22).

## Choose and compare

1. The sheet lists the backups from `data:status` (each `BackupEntry` carries its file `name`, never a path) and "Another file…" — src/renderer/src/backup/RestoreFlow.tsx:51
2. "Another file…" → `data:pickFile`: native dialog, checked apart (`inspect` task), and named by a `picked:<uuid>` token that lives in main memory for this run — src/main/data/register.ts:189
3. `data:compare(source)` resolves the name/token to a file (`sourceOf`, only names that `listBackups` returns) — src/main/data/register.ts:177, src/main/data/register.ts:210
4. The comparison runs in the backup utility process (`compare` task: `inspectDatabase` first, then `compareFiles`) — src/main/data/backupWorker.ts; both files are opened read-only and read with plain SQL on `blocks`, so an older backup is compared without being migrated — src/main/data/compare.ts:59
5. Unit = a page or database (rows fold into their database, linked views into the page holding them); a unit is "same" when the hash of every live block it is made of matches (type, parent, child list, props — not `updated_at`), so edited-and-edited-back reads as same. Trash (or below it) counts as absent — src/main/data/compare.ts:209
6. The sheet groups the differences: deleted since (`only-backup`), changed since, new since (`only-now`, never restorable); counts are whole, lists capped at `MAX_LISTED_DIFFERENCES` (src/shared/data.ts)

## One page

7. "Restore…" on an item → optional "With the N pages below it" → `data:restorePage(source, pageId, withSubpages)` — src/renderer/src/backup/RestoreFlow.tsx:102
8. `restorePageSteps`: read the page out of the backup first (`readBackupPages`: one subtree, read-only, in main), then a `before-restore` backup of everything, then write — src/main/data/restoreSteps.ts:23, src/main/data/pageRestore.ts:30
9. `Repository.restoreFromBackup` in one transaction: pages that no longer exist are inserted under their own ids (where free) and where they were; existing ones (also in the Trash) go through `restoreReplace`, the same path as restoring a version, so the page keeps a `restore` version of what it was. Without sub-pages, nested pages that were moved out or trashed since are left alone (`withOwnRefs`); a database's rows that are gone come back (`missing` mode) — src/main/db/repository.ts:1756
10. Back in the window: the tree is reloaded, the result is said above the list, and the comparison is run again

## Everything

11. "Restore everything…" opens a confirm block inside the sheet (no native question): what comes back / changes / goes, the backup-first promise, the sync note — src/renderer/src/backup/RestoreFlow.tsx:299
12. `restoreAllSteps`: refuse while recording, inspect the backup, `before-restore` backup, stage (`stageRestore`), relaunch — src/main/data/restoreSteps.ts:66. If the backup of now fails, the restore is refused unless the start-up check found the database damaged (then `applyStagedRestore` keeps it as `sel.db.replaced`)
13. Next start: `applyStagedRestore` puts it in place before the database opens (see [startup](startup.md) step 4)

## Integrity check at start

- `start()` of the data feature (first window) runs `quick_check` on the open database in the utility process (`integrity` task, `checkIntegrity`) — src/main/data/register.ts:159, src/main/data/backups.ts:222. A `quick_check` that throws (an FTS index it cannot read) counts as damage; busy/locked counts as "could not check".
- Damaged → `BackupStatus.integrity = 'damaged'`, a lasting `database-damaged` notice (src/shared/api.ts:260), shown as a calm toast with "Open backups" (src/renderer/src/failures/global.ts:31); the restore row turns into the way back.

## Tests

- src/main/data/restore.test.ts: comparison, single-page restore leaves every other row byte-identical, sub-pages, deleted-forever pages and database rows, before-restore backup ordering, refusal paths, integrity on sound/damaged/junk/missing files.
- src/renderer/src/backup/RestoreFlow.test.tsx: groups, single-page call, confirm step before `restoreAll`.
