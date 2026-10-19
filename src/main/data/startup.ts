import { join } from 'node:path'
import { app, dialog, shell } from 'electron'
import { backupWhen, DATA_COPY, dataLocale } from '../../shared/dataCopy'
import { openDatabase, type Repository } from '../db'
import { DB_FILE } from '../legacy'
import { BACKUPS_DIR, damagedName, isDamageError, isNewerError, newestGoodBackup, restoreOverDamaged } from './backups'
import { openReadOnly } from './register'

/**
 * The database could not be opened at start. Instead of a raw SQLite message and an exit, the
 * person is told what happened in their language and, when the file is damaged and a backup
 * passes its check, offered that backup. The damaged file is never deleted: it is renamed and
 * stays next to the restored one. Resolves with the opened database, or null to quit.
 * Loaded only on this path (see ../index.ts).
 */
export async function recoverDatabase(error: unknown, userData: string): Promise<Repository | null> {
  await app.whenReady()
  // The setting of the AI language is in the database that did not open: the system's language decides.
  const locale = dataLocale(null, app.getLocale())
  const words = DATA_COPY[locale]

  if (isNewerError(error)) {
    await dialog.showMessageBox({
      type: 'error',
      message: words.newerTitle,
      detail: words.newerDetail,
      buttons: [words.quit],
      noLink: true,
      title: 'sel'
    })
    return null
  }

  const showFolder = async (): Promise<null> => {
    await shell.openPath(userData)
    return null
  }

  if (!isDamageError(error)) {
    const reason = error instanceof Error ? error.message : String(error)
    const answer = await dialog.showMessageBox({
      type: 'error',
      message: words.couldNotOpen,
      detail: words.otherDetail(reason, userData),
      buttons: [words.showTheFolder, words.quit],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'sel'
    })
    return answer.response === 0 ? showFolder() : null
  }

  const backup = newestGoodBackup(join(userData, BACKUPS_DIR), openReadOnly)
  if (!backup) {
    const answer = await dialog.showMessageBox({
      type: 'error',
      message: words.couldNotOpen,
      detail: words.damagedWithoutBackup(userData),
      buttons: [words.showTheFolder, words.quit],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'sel'
    })
    return answer.response === 0 ? showFolder() : null
  }

  const now = Date.now()
  const answer = await dialog.showMessageBox({
    type: 'warning',
    message: words.couldNotOpen,
    detail: words.damagedWithBackup(backupWhen(backup.file.at, now, locale), backup.pages, damagedName(now)),
    buttons: [words.restoreBackup, words.showTheFolder, words.quit],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    title: 'sel'
  })
  if (answer.response === 1) return showFolder()
  if (answer.response !== 0) return null
  try {
    restoreOverDamaged(userData, backup.file.path, now)
    return openDatabase(join(userData, DB_FILE))
  } catch (err) {
    console.error('[data] the backup could not be restored', err)
    dialog.showErrorBox(words.couldNotOpen, words.restoreFailed)
    return null
  }
}
