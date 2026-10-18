// What the backups row says: pure, tested without a window.
import type { BackupStatus } from '@shared/data'
import { backupWhen, byteSize, DATA_COPY, type DataLocale } from '@shared/dataCopy'

export interface BackupsLine {
  help: string
  /** Why the last attempt made no backup, when it failed. */
  problem: string | null
}

export function describeBackups(status: BackupStatus, now: number, locale: DataLocale): BackupsLine {
  const copy = DATA_COPY[locale]
  const newest = status.backups[0]
  const total = status.backups.reduce((sum, backup) => sum + backup.size, 0)
  return {
    help: copy.backupsHelp(newest ? backupWhen(newest.at, now, locale) : null, status.backups.length, byteSize(total, locale)),
    problem: status.problem ? copy.problem[status.problem] : null
  }
}
