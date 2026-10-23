// What the app says when something fails, in English and in Brazilian Portuguese. Chosen like
// the home's words (home/copy.ts). Pure: no React, no DOM.
import type { AppNotice } from '../../../shared/api'
import type { HomeLocale } from '../home/copy'

export interface FailureCopy {
  /** A write was refused; the screen went back to what is stored. */
  changeUndone: string
  undoFailed: string
  redoFailed: string
  /** A rejection nobody handled: most often a write that did not reach the database. */
  unhandled: string
  /** An error nobody caught in this window. */
  uncaught: string
  /** What the main process asks the windows to say. */
  notice: Record<AppNotice, string>
  /** The action of the `database-damaged` notice: Settings → General → Data. */
  openBackups: string
  /** A screen that could not be drawn (the root error boundary). */
  brokenTitle: string
  brokenText: string
  reload: string
}

const EN: FailureCopy = {
  changeUndone: "Couldn't save that change. It was undone.",
  undoFailed: "Couldn't undo that change.",
  redoFailed: "Couldn't redo that change.",
  unhandled: 'Something went wrong. Your last change may not have been saved.',
  uncaught: 'Something went wrong in this window.',
  notice: {
    crashed: 'Something went wrong. Save your work and restart sel.',
    'seed-failed': 'The welcome page could not be created. sel will try again next time it starts.',
    'database-damaged':
      'sel found a problem in its database file. Your pages are still open; to be safe, restore a recent backup in Settings → General → Data.'
  },
  openBackups: 'Open backups',
  brokenTitle: 'Something went wrong',
  brokenText: 'This window could not be drawn. Reloading it keeps everything that was saved.',
  reload: 'Reload'
}

const PT: FailureCopy = {
  changeUndone: 'Não foi possível salvar essa mudança. Ela foi desfeita.',
  undoFailed: 'Não foi possível desfazer essa mudança.',
  redoFailed: 'Não foi possível refazer essa mudança.',
  unhandled: 'Algo deu errado. Sua última mudança pode não ter sido salva.',
  uncaught: 'Algo deu errado nesta janela.',
  notice: {
    crashed: 'Algo deu errado. Salve e reinicie o sel.',
    'seed-failed': 'Não foi possível criar a página de boas-vindas. O sel tenta de novo na próxima vez que abrir.',
    'database-damaged':
      'O sel encontrou um problema no arquivo do banco de dados. Suas páginas continuam abertas; por segurança, restaure um backup recente em Configurações → General → Data.'
  },
  openBackups: 'Abrir backups',
  brokenTitle: 'Algo deu errado',
  brokenText: 'Esta janela não pôde ser desenhada. Recarregar mantém tudo o que foi salvo.',
  reload: 'Recarregar'
}

export const FAILURE_COPY: Record<HomeLocale, FailureCopy> = { en: EN, 'pt-BR': PT }
