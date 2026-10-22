// The words of the archive, in English and in Brazilian Portuguese, chosen the way Herman's
// are (main/herman/service.ts hermanLocale): the language set for AI answers when it is one of
// the two, else the system's. Pure: no React, no DOM.
import { isAiLanguage } from '../../../shared/ai'

export type ArchiveLocale = 'en' | 'pt-BR'

export interface ArchiveCopy {
  /** Menu item and button: put the page away. */
  archive: string
  unarchive: string
  open: string
  /** The sidebar entry and the title of its popover. */
  section: string
  /** Next to an archived page in search results. */
  badge: string
  banner: string
  archived: string
  unarchived: string
  undo: string
  searchPlaceholder: string
  empty: string
  noMatches: string
  footer: string
  /** "Archived on 3 Oct" */
  archivedOn: (date: string) => string
  /** Palette commands. */
  archiveThisPage: string
  unarchiveThisPage: string
  couldNotArchive: string
  couldNotUnarchive: string
  couldNotLoad: string
}

export const ARCHIVE_COPY: Record<ArchiveLocale, ArchiveCopy> = {
  en: {
    archive: 'Archive',
    unarchive: 'Unarchive',
    open: 'Open',
    section: 'Archive',
    badge: 'Archived',
    banner: 'This page is archived.',
    archived: 'Page archived.',
    unarchived: 'Page back in the sidebar.',
    undo: 'Undo',
    searchPlaceholder: 'Search archived pages',
    empty: 'Nothing is archived',
    noMatches: 'No matches',
    footer: 'Archived pages stay where they were, out of the sidebar. Search still finds them.',
    archivedOn: (date) => `Archived on ${date}`,
    archiveThisPage: 'Archive this page',
    unarchiveThisPage: 'Unarchive this page',
    couldNotArchive: 'Could not archive the page.',
    couldNotUnarchive: 'Could not unarchive the page.',
    couldNotLoad: 'Could not load the archive.'
  },
  'pt-BR': {
    archive: 'Arquivar',
    unarchive: 'Desarquivar',
    open: 'Abrir',
    section: 'Arquivo',
    badge: 'Arquivada',
    banner: 'Esta página está arquivada.',
    archived: 'Página arquivada.',
    unarchived: 'A página voltou para a barra lateral.',
    undo: 'Desfazer',
    searchPlaceholder: 'Buscar páginas arquivadas',
    empty: 'Nada arquivado',
    noMatches: 'Nada encontrado',
    footer: 'Páginas arquivadas ficam onde estavam, fora da barra lateral. A busca ainda as encontra.',
    archivedOn: (date) => `Arquivada em ${date}`,
    archiveThisPage: 'Arquivar esta página',
    unarchiveThisPage: 'Desarquivar esta página',
    couldNotArchive: 'Não foi possível arquivar a página.',
    couldNotUnarchive: 'Não foi possível desarquivar a página.',
    couldNotLoad: 'Não foi possível abrir o arquivo.'
  }
}

/** Words the palette finds the archive commands by, in both languages. */
export const ARCHIVE_KEYWORDS: readonly string[] = [
  'archive',
  'unarchive',
  'put away',
  'hide',
  'arquivar',
  'desarquivar',
  'arquivo',
  'guardar'
]

/** The language of the archive's words: the AI answer language when it is one of the two, else the system's. */
export function archiveLocale(aiLanguage: unknown, systemLocale: string | undefined): ArchiveLocale {
  if (isAiLanguage(aiLanguage)) return aiLanguage === 'pt-BR' ? 'pt-BR' : 'en'
  return typeof systemLocale === 'string' && /^pt\b/i.test(systemLocale) ? 'pt-BR' : 'en'
}
