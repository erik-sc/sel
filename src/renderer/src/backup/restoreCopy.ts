// The words of the guided restore (RestoreFlow.tsx), in English and in Brazilian Portuguese, in the
// language of the other rows of Settings → Data (see ./locale.ts). Pure: no React, no DOM.
import type { BackupKind, PageChange, RestoreRefusal } from '@shared/data'
import type { DataLocale } from '@shared/dataCopy'

export interface RestoreCopy {
  title: string
  close: string
  /** The row's help when the check at start found the database damaged. */
  damagedHelp: string
  // ---- step 1: which backup
  chooseIntro: string
  noBackups: string
  kind: Record<BackupKind, string>
  anotherFile: string
  // ---- step 2: what differs
  back: string
  comparing: string
  backupOf: (when: string, pages: number) => string
  nothingDiffers: string
  group: Record<PageChange, (count: number) => string>
  groupHelp: Record<PageChange, string>
  more: (count: number) => string
  untitled: string
  restoreThis: string
  // ---- one page
  withSubpages: (count: number) => string
  onePageNote: string
  restorePage: string
  restoringPage: string
  cancel: string
  restored: (title: string, pages: number) => string
  openPage: string
  // ---- everything
  restoreAll: string
  restoreAllHelp: string
  confirmTitle: (when: string) => string
  confirmBody: (counts: { back: number; changed: number; gone: number }) => string
  confirmSafety: string
  syncNote: string
  confirmAll: string
  restarting: string
  refusal: Record<RestoreRefusal, string>
}

const EN: RestoreCopy = {
  title: 'Restore from a backup',
  close: 'Close',
  damagedHelp:
    'sel found a problem in its database file when it started. Your pages are still here; restoring a recent backup is the safe way back.',
  chooseIntro: 'Choose a backup to see what changed since. Nothing changes until you restore.',
  noBackups: 'There are no backups yet. sel makes one every day; "Back up now" makes one at once.',
  kind: { auto: 'Daily', manual: 'Made by hand', 'before-restore': 'Before a restore' },
  anotherFile: 'Another file…',
  back: 'Backups',
  comparing: 'Comparing with now…',
  backupOf: (when, pages) => `Backup of ${when} · ${pages} ${pages === 1 ? 'page' : 'pages'}`,
  nothingDiffers: 'Nothing differs: every page is as it is in this backup.',
  group: {
    'only-backup': (n) => `Deleted since (${n})`,
    changed: (n) => `Changed since (${n})`,
    'only-now': (n) => `New since (${n})`
  },
  groupHelp: {
    'only-backup': 'In the backup, and no longer here (or in the Trash).',
    changed: 'Here and in the backup, with different content.',
    'only-now': 'Made after the backup. Restoring one page never touches these.'
  },
  more: (n) => `And ${n} more.`,
  untitled: 'Untitled',
  restoreThis: 'Restore…',
  withSubpages: (n) => `With the ${n} ${n === 1 ? 'page' : 'pages'} below it`,
  onePageNote: 'Only this page changes. sel backs up everything first, and the page keeps a version of what it is now.',
  restorePage: 'Restore this page',
  restoringPage: 'Restoring…',
  cancel: 'Cancel',
  restored: (title, pages) => `"${title}" is back as it was in the backup${pages > 1 ? `, with ${pages - 1} more` : ''}.`,
  openPage: 'Open page',
  restoreAll: 'Restore everything…',
  restoreAllHelp: 'Bring the whole workspace back to this backup. sel restarts.',
  confirmTitle: (when) => `Restore everything to ${when}?`,
  confirmBody: ({ back, changed, gone }) =>
    [
      back ? `${back} ${back === 1 ? 'page comes' : 'pages come'} back` : '',
      changed ? `${changed} ${changed === 1 ? 'page goes' : 'pages go'} back to how ${changed === 1 ? 'it was' : 'they were'}` : '',
      gone ? `${gone} ${gone === 1 ? 'page' : 'pages'} made since ${gone === 1 ? 'is' : 'are'} not in it and will be gone` : ''
    ]
      .filter(Boolean)
      .join(', ')
      .replace(/^./, (c) => c.toUpperCase())
      .concat('.'),
  confirmSafety: 'First sel keeps a backup of everything as it is now, so this can be undone. Then it restarts with the one you chose.',
  syncNote: 'Sync is on: the next sync brings back what changed on your other devices since then.',
  confirmAll: 'Restore everything and restart',
  restarting: 'Restarting…',
  refusal: {
    'backup-failed': 'Nothing was restored: sel could not back up everything as it is now first.',
    'not-in-backup': 'That page is not in this backup.',
    notebook: 'Past days of Meditations never change: that page cannot go back.',
    'kind-changed': 'That page has since become another kind of block and cannot be restored over.',
    busy: 'Stop the recording first: restoring everything restarts sel.'
  }
}

const PT: RestoreCopy = {
  title: 'Restaurar de um backup',
  close: 'Fechar',
  damagedHelp:
    'O sel encontrou um problema no arquivo do banco de dados ao abrir. Suas páginas continuam aqui; restaurar um backup recente é o caminho seguro de volta.',
  chooseIntro: 'Escolha um backup para ver o que mudou desde então. Nada muda até você restaurar.',
  noBackups: 'Ainda não há backups. O sel faz um por dia; "Fazer backup agora" faz um na hora.',
  kind: { auto: 'Diário', manual: 'Feito à mão', 'before-restore': 'Antes de restaurar' },
  anotherFile: 'Outro arquivo…',
  back: 'Backups',
  comparing: 'Comparando com agora…',
  backupOf: (when, pages) => `Backup de ${when} · ${pages} ${pages === 1 ? 'página' : 'páginas'}`,
  nothingDiffers: 'Nada é diferente: todas as páginas estão como neste backup.',
  group: {
    'only-backup': (n) => `Apagadas desde então (${n})`,
    changed: (n) => `Alteradas desde então (${n})`,
    'only-now': (n) => `Novas desde então (${n})`
  },
  groupHelp: {
    'only-backup': 'Estão no backup e não estão mais aqui (ou estão na Lixeira).',
    changed: 'Estão aqui e no backup, com conteúdo diferente.',
    'only-now': 'Criadas depois do backup. Restaurar uma página nunca mexe nelas.'
  },
  more: (n) => `E mais ${n}.`,
  untitled: 'Sem título',
  restoreThis: 'Restaurar…',
  withSubpages: (n) => `Com ${n === 1 ? 'a página' : `as ${n} páginas`} abaixo dela`,
  onePageNote: 'Só esta página muda. Antes, o sel faz backup de tudo, e a página guarda uma versão de como está agora.',
  restorePage: 'Restaurar esta página',
  restoringPage: 'Restaurando…',
  cancel: 'Cancelar',
  restored: (title, pages) => `"${title}" voltou a ser como no backup${pages > 1 ? `, com mais ${pages - 1}` : ''}.`,
  openPage: 'Abrir página',
  restoreAll: 'Restaurar tudo…',
  restoreAllHelp: 'Volta o workspace inteiro a este backup. O sel reinicia.',
  confirmTitle: (when) => `Restaurar tudo para ${when}?`,
  confirmBody: ({ back, changed, gone }) =>
    [
      back ? `${back} ${back === 1 ? 'página volta' : 'páginas voltam'}` : '',
      changed ? `${changed} ${changed === 1 ? 'página volta a ser como era' : 'páginas voltam a ser como eram'}` : '',
      gone
        ? `${gone} ${gone === 1 ? 'página criada' : 'páginas criadas'} depois não ${gone === 1 ? 'está' : 'estão'} nele e ${gone === 1 ? 'some' : 'somem'}`
        : ''
    ]
      .filter(Boolean)
      .join(', ')
      .replace(/^./, (c) => c.toUpperCase())
      .concat('.'),
  confirmSafety:
    'Antes, o sel guarda um backup de tudo como está agora, para que isso possa ser desfeito. Depois reinicia com o backup escolhido.',
  syncNote: 'O sync está ligado: o próximo sync traz de volta o que mudou nos seus outros aparelhos desde então.',
  confirmAll: 'Restaurar tudo e reiniciar',
  restarting: 'Reiniciando…',
  refusal: {
    'backup-failed': 'Nada foi restaurado: o sel não conseguiu fazer antes um backup de tudo como está agora.',
    'not-in-backup': 'Essa página não está neste backup.',
    notebook: 'Os dias passados de Meditações nunca mudam: essa página não pode voltar.',
    'kind-changed': 'Essa página virou outro tipo de bloco e não pode ser restaurada por cima.',
    busy: 'Pare a gravação antes: restaurar tudo reinicia o sel.'
  }
}

export const RESTORE_COPY: Record<DataLocale, RestoreCopy> = { en: EN, 'pt-BR': PT }
