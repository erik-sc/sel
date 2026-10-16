// The words of the home, in English and in Brazilian Portuguese, chosen like the notebook's
// and Herman's: the language set for AI answers when it is one of the two, else the system's.
// Pure: no React, no DOM.
import { isAiLanguage } from '../../../shared/ai'
import type { HomeScreen, StartupMode } from '../../../shared/home'

export type HomeLocale = 'en' | 'pt-BR'

export interface HomeCopy {
  home: string
  /** The Home button when no home is chosen yet. */
  choose: string
  /** The Home button when the home page is in the Trash. */
  trashed: string
  /** When the home page is not on this device: deleted, or not synced here yet. */
  missing: string
  setAsHome: string
  removeAsHome: string
  /** Settings → General → Pages. */
  homeLabel: string
  /** Takes the shortcut, as this platform writes it. */
  homeHelp: (shortcut: string) => string
  none: string
  screensGroup: string
  pagesGroup: string
  untitled: string
  startupLabel: string
  startupHelp: string
  startup: Record<StartupMode, string>
  screens: Record<HomeScreen, string>
  /** On the empty state. */
  openHome: string
  saveFailed: string
}

export const HOME_COPY: Record<HomeLocale, HomeCopy> = {
  en: {
    home: 'Home',
    choose: 'Choose a home in Settings',
    trashed: 'The home went to the Trash',
    missing: 'The home page is not on this device',
    setAsHome: 'Set as home',
    removeAsHome: 'Stop being the home',
    homeLabel: 'Home',
    homeHelp: (shortcut) => `What the Home button opens (${shortcut}). The same on every synced device.`,
    none: 'None',
    screensGroup: 'Screens',
    pagesGroup: 'Pages',
    untitled: 'Untitled',
    startupLabel: 'When sel opens',
    startupHelp: 'On this device only.',
    startup: { tabs: 'Restore tabs', home: 'Open the home', both: 'Both, home first' },
    screens: { _today: 'Today', _tasks: 'Tasks', _calendar: 'Calendar', _notebook: 'Ink notebook' },
    openHome: 'Open the home',
    saveFailed: 'The home could not be saved.'
  },
  'pt-BR': {
    home: 'Home',
    choose: 'Escolha uma home nas Configurações',
    trashed: 'A home foi para a lixeira',
    missing: 'A página da home não está neste dispositivo',
    setAsHome: 'Definir como home',
    removeAsHome: 'Deixar de ser a home',
    homeLabel: 'Home',
    homeHelp: (shortcut) => `O que o botão Home abre (${shortcut}). A mesma em todos os dispositivos sincronizados.`,
    none: 'Nenhuma',
    screensGroup: 'Telas',
    pagesGroup: 'Páginas',
    untitled: 'Sem título',
    startupLabel: 'Ao abrir o sel',
    startupHelp: 'Só neste dispositivo.',
    startup: { tabs: 'Restaurar abas', home: 'Abrir a home', both: 'Os dois (home primeiro)' },
    screens: { _today: 'Hoje', _tasks: 'Tarefas', _calendar: 'Calendário', _notebook: 'Caderno de tinta' },
    openHome: 'Abrir a home',
    saveFailed: 'Não foi possível salvar a home.'
  }
}

export function homeLocale(aiLanguage: unknown, systemLocale: string | undefined): HomeLocale {
  if (isAiLanguage(aiLanguage)) return aiLanguage === 'pt-BR' ? 'pt-BR' : 'en'
  return typeof systemLocale === 'string' && /^pt\b/i.test(systemLocale) ? 'pt-BR' : 'en'
}
