// The words of backups, restore and export, in English and in Brazilian Portuguese: the rows in
// Settings and the native dialogs of the main process say the same thing. The language is chosen
// the way Herman's is (main/herman/service.ts hermanLocale): the language set for AI answers
// when it is one of the two, else the system's. Pure: no Electron, no DOM.
import { isAiLanguage } from './ai'
import type { BackupFileProblem, BackupProblem } from './data'

export type DataLocale = 'en' | 'pt-BR'

export function dataLocale(aiLanguage: unknown, systemLocale: string | undefined): DataLocale {
  if (isAiLanguage(aiLanguage)) return aiLanguage === 'pt-BR' ? 'pt-BR' : 'en'
  return typeof systemLocale === 'string' && /^pt\b/i.test(systemLocale) ? 'pt-BR' : 'en'
}

export interface DataCopy {
  // ---- Settings → General → Data
  backups: string
  /** What backups are, and the newest one: "…Last: today, 09:12 · 4 copies, 12 MB." */
  backupsHelp: (last: string | null, count: number, size: string) => string
  backUpNow: string
  backingUp: string
  showFolder: string
  restore: string
  restoreHelp: string
  chooseBackup: string
  restarting: string
  exportAll: string
  exportHelp: string
  chooseFolder: string
  exporting: string
  exported: (pages: number, images: number) => string
  problem: Record<BackupProblem, string>
  fileProblem: Record<BackupFileProblem, string>
  somethingWrong: string
  // ---- native dialogs (main process)
  chooseBackupTitle: string
  backupFilter: string
  restoreQuestion: (when: string) => string
  restoreDetail: (pages: number, synced: boolean) => string
  restoreAndRestart: string
  cancel: string
  exportTitle: string
  exportFolder: (day: string) => string
  /** The folder of pages that are archived, in an export. */
  archiveFolder: string
  couldNotOpen: string
  damagedWithBackup: (when: string, pages: number, aside: string) => string
  damagedWithoutBackup: (folder: string) => string
  restoreBackup: string
  showTheFolder: string
  quit: string
  newerTitle: string
  newerDetail: string
  otherDetail: (reason: string, folder: string) => string
  restoreFailed: string
  // ---- words of time and size
  today: string
  yesterday: string
}

export const DATA_COPY: Record<DataLocale, DataCopy> = {
  en: {
    backups: 'Backups',
    backupsHelp: (last, count, size) =>
      `Every day sel keeps a copy of everything on this computer. ${last ? `Last: ${last} · ${count} ${count === 1 ? 'copy' : 'copies'}, ${size}.` : 'None yet.'}`,
    backUpNow: 'Back up now',
    backingUp: 'Backing up…',
    showFolder: 'Show folder',
    restore: 'Restore a backup',
    restoreHelp: 'Bring everything back to how it was in a backup. sel restarts.',
    chooseBackup: 'Choose backup…',
    restarting: 'Restarting…',
    exportAll: 'Export everything',
    exportHelp: 'Every page as a Markdown file, with its images, in a folder you choose.',
    chooseFolder: 'Choose folder…',
    exporting: 'Exporting…',
    exported: (pages, images) =>
      `Exported ${pages} ${pages === 1 ? 'page' : 'pages'}${images ? ` and ${images} ${images === 1 ? 'image' : 'images'}` : ''}.`,
    problem: {
      'disk-full': 'The last backup was not made: there is not enough free disk space.',
      damaged: 'The last backup did not pass its check and was discarded. The earlier ones are kept.',
      failed: 'The last backup could not be made. The earlier ones are kept.'
    },
    fileProblem: {
      'not-sel': 'That file is not a sel backup.',
      damaged: 'That backup is damaged and cannot be restored.',
      newer: 'That backup was made by a newer version of sel. Update sel first.',
      unreadable: 'That file could not be read.',
      current: 'That is the database sel is using now. Choose a backup.'
    },
    somethingWrong: 'Something went wrong. Nothing was changed.',
    chooseBackupTitle: 'Choose a backup',
    backupFilter: 'sel backups',
    restoreQuestion: (when) => `Restore the backup of ${when}?`,
    restoreDetail: (pages, synced) =>
      `It holds ${pages} ${pages === 1 ? 'page' : 'pages'}. sel first keeps a backup of everything as it is now, so this can be undone, then restarts with the one you chose.` +
      (synced ? '\n\nSync is on: the next sync brings back what changed on your other devices since then.' : ''),
    restoreAndRestart: 'Restore and restart',
    cancel: 'Cancel',
    exportTitle: 'Export everything to a folder',
    exportFolder: (day) => `sel export ${day}`,
    archiveFolder: 'Archive',
    couldNotOpen: 'sel could not open its database.',
    damagedWithBackup: (when, pages, aside) =>
      `The file looks damaged. There is a backup from ${when}, with ${pages} ${pages === 1 ? 'page' : 'pages'}.\n\nRestoring it keeps the damaged file next to it, as ${aside}: nothing is deleted.`,
    damagedWithoutBackup: (folder) =>
      `The file looks damaged, and there is no backup to restore. Nothing was deleted: the file is in this folder.\n\n${folder}`,
    restoreBackup: 'Restore the backup',
    showTheFolder: 'Show the folder',
    quit: 'Quit',
    newerTitle: 'This database was written by a newer version of sel.',
    newerDetail: 'Update sel to open it. Nothing was changed.',
    otherDetail: (reason, folder) =>
      `${reason}\n\nNothing was deleted. If another program is using the file, close it and start sel again. The file is in this folder:\n\n${folder}`,
    restoreFailed: 'The backup could not be restored. Nothing was deleted.',
    today: 'today',
    yesterday: 'yesterday'
  },
  'pt-BR': {
    backups: 'Backups',
    backupsHelp: (last, count, size) =>
      `Todo dia o sel guarda uma cópia de tudo neste computador. ${last ? `Último: ${last} · ${count} ${count === 1 ? 'cópia' : 'cópias'}, ${size}.` : 'Nenhum ainda.'}`,
    backUpNow: 'Fazer backup agora',
    backingUp: 'Fazendo backup…',
    showFolder: 'Mostrar pasta',
    restore: 'Restaurar um backup',
    restoreHelp: 'Volta tudo ao que era em um backup. O sel reinicia.',
    chooseBackup: 'Escolher backup…',
    restarting: 'Reiniciando…',
    exportAll: 'Exportar tudo',
    exportHelp: 'Cada página como um arquivo Markdown, com as imagens, numa pasta que você escolhe.',
    chooseFolder: 'Escolher pasta…',
    exporting: 'Exportando…',
    exported: (pages, images) =>
      `${pages} ${pages === 1 ? 'página exportada' : 'páginas exportadas'}${images ? ` e ${images} ${images === 1 ? 'imagem' : 'imagens'}` : ''}.`,
    problem: {
      'disk-full': 'O último backup não foi feito: falta espaço livre em disco.',
      damaged: 'O último backup não passou na verificação e foi descartado. Os anteriores continuam guardados.',
      failed: 'O último backup não pôde ser feito. Os anteriores continuam guardados.'
    },
    fileProblem: {
      'not-sel': 'Esse arquivo não é um backup do sel.',
      damaged: 'Esse backup está danificado e não pode ser restaurado.',
      newer: 'Esse backup foi feito por uma versão mais nova do sel. Atualize o sel antes.',
      unreadable: 'Não foi possível ler esse arquivo.',
      current: 'Esse é o banco que o sel está usando agora. Escolha um backup.'
    },
    somethingWrong: 'Algo deu errado. Nada foi alterado.',
    chooseBackupTitle: 'Escolha um backup',
    backupFilter: 'Backups do sel',
    restoreQuestion: (when) => `Restaurar o backup de ${when}?`,
    restoreDetail: (pages, synced) =>
      `Ele tem ${pages} ${pages === 1 ? 'página' : 'páginas'}. Antes, o sel guarda um backup de tudo como está agora, para que isso possa ser desfeito; depois reinicia com o backup escolhido.` +
      (synced ? '\n\nO sync está ligado: o próximo sync traz de volta o que mudou nos seus outros aparelhos desde então.' : ''),
    restoreAndRestart: 'Restaurar e reiniciar',
    cancel: 'Cancelar',
    exportTitle: 'Exportar tudo para uma pasta',
    exportFolder: (day) => `sel exportação ${day}`,
    archiveFolder: 'Arquivo',
    couldNotOpen: 'O sel não conseguiu abrir o banco de dados.',
    damagedWithBackup: (when, pages, aside) =>
      `O arquivo parece danificado. Existe um backup de ${when}, com ${pages} ${pages === 1 ? 'página' : 'páginas'}.\n\nAo restaurar, o arquivo danificado fica guardado ao lado, como ${aside}: nada é apagado.`,
    damagedWithoutBackup: (folder) =>
      `O arquivo parece danificado, e não há backup para restaurar. Nada foi apagado: o arquivo está nesta pasta.\n\n${folder}`,
    restoreBackup: 'Restaurar o backup',
    showTheFolder: 'Mostrar a pasta',
    quit: 'Sair',
    newerTitle: 'Este banco de dados foi gravado por uma versão mais nova do sel.',
    newerDetail: 'Atualize o sel para abri-lo. Nada foi alterado.',
    otherDetail: (reason, folder) =>
      `${reason}\n\nNada foi apagado. Se outro programa estiver usando o arquivo, feche-o e abra o sel de novo. O arquivo está nesta pasta:\n\n${folder}`,
    restoreFailed: 'Não foi possível restaurar o backup. Nada foi apagado.',
    today: 'hoje',
    yesterday: 'ontem'
  }
}

const INTL_LOCALE: Record<DataLocale, string> = { en: 'en-GB', 'pt-BR': 'pt-BR' }

/** "today, 09:12", "yesterday, 18:40", "12 Oct, 14:32" (in the locale's own way). */
export function backupWhen(at: number, now: number, locale: DataLocale): string {
  const copy = DATA_COPY[locale]
  const time = new Intl.DateTimeFormat(INTL_LOCALE[locale], { hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  const day = new Date(at).toDateString()
  if (day === new Date(now).toDateString()) return `${copy.today}, ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day === yesterday.toDateString()) return `${copy.yesterday}, ${time}`
  const date = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: 'numeric',
    month: 'short',
    ...(new Date(at).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' as const } : {})
  }).format(at)
  return `${date}, ${time}`
}

/** "840 KB", "12 MB", "1.2 GB" ("1,2 GB" in Portuguese). */
export function byteSize(bytes: number, locale: DataLocale): string {
  const units = ['bytes', 'KB', 'MB', 'GB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const number = new Intl.NumberFormat(INTL_LOCALE[locale], { maximumFractionDigits: unit >= 2 && value < 10 ? 1 : 0 }).format(value)
  return `${number} ${units[unit]}`
}
