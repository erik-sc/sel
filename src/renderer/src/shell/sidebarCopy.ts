// The words of the sidebar and of its settings, in English and in Brazilian Portuguese, chosen
// like the home's and the archive's: the language set for AI answers when it is one of the two,
// else the system's. Pure: no React, no DOM.
import { isAiLanguage } from '../../../shared/ai'
import type { SidebarItemId, SidebarZone } from '../../../shared/sidebar'

export type SidebarLocale = 'en' | 'pt-BR'

export interface SidebarCopy {
  /** What each item is called in the sidebar and in its settings. */
  items: Record<SidebarItemId, string>
  /** The heading over the page tree. */
  privatePages: string
  addPage: string
  closeSidebar: string
  /** The right-click menu of an item. */
  hide: string
  customize: string
  /** When every item is hidden. */
  empty: string
  emptyAction: string
  /** Settings → Sidebar. */
  section: string
  itemsTitle: string
  itemsHelp: (palette: string) => string
  zones: Record<SidebarZone, string>
  middleHelp: string
  show: (item: string) => string
  moved: (item: string, place: number, count: number, zone: string) => string
  restore: string
  restoreHelp: string
  saveFailed: string
  /** Palette entries. */
  customizeCommand: string
  openTrash: string
  openArchive: string
}

export const SIDEBAR_COPY: Record<SidebarLocale, SidebarCopy> = {
  en: {
    items: {
      search: 'Search',
      home: 'Home',
      today: 'Today',
      calendar: 'Calendar',
      tasks: 'Tasks',
      meditations: 'Meditations',
      sky: 'Sky',
      'close-day': 'Close the day',
      'new-page': 'New page',
      'new-meeting': 'New meeting',
      favorites: 'Favorites',
      pages: 'Pages',
      trash: 'Trash',
      archive: 'Archive',
      feedback: 'Feedback',
      settings: 'Settings',
      sync: 'Sync'
    },
    privatePages: 'Private',
    addPage: 'Add a page',
    closeSidebar: 'Close sidebar',
    hide: 'Hide from the sidebar',
    customize: 'Customize the sidebar…',
    empty: 'Empty sidebar',
    emptyAction: 'Customize',
    section: 'Sidebar',
    itemsTitle: 'Items',
    itemsHelp: (palette) =>
      `Drag to reorder, or use Alt+↑ and Alt+↓. A hidden item is still in the command palette (${palette}) and keeps its shortcut. The same on every synced device.`,
    zones: { top: 'Top', middle: 'Middle', footer: 'Bottom' },
    middleHelp: 'Scrolls with the pages. Its two items change places only with each other.',
    show: (item) => `Show ${item} in the sidebar`,
    moved: (item, place, count, zone) => `${item}, ${place} of ${count}, ${zone}`,
    restore: 'Restore default',
    restoreHelp: 'Every item back, in the original order.',
    saveFailed: 'The sidebar could not be saved.',
    customizeCommand: 'Customize the sidebar…',
    openTrash: 'Open the Trash',
    openArchive: 'Open the Archive'
  },
  'pt-BR': {
    items: {
      search: 'Buscar',
      home: 'Home',
      today: 'Hoje',
      calendar: 'Calendário',
      tasks: 'Tarefas',
      meditations: 'Meditações',
      sky: 'Céu',
      'close-day': 'Fechar o dia',
      'new-page': 'Nova página',
      'new-meeting': 'Nova reunião',
      favorites: 'Favoritos',
      pages: 'Páginas',
      trash: 'Lixeira',
      archive: 'Arquivo',
      feedback: 'Feedback',
      settings: 'Configurações',
      sync: 'Sincronização'
    },
    privatePages: 'Privadas',
    addPage: 'Adicionar uma página',
    closeSidebar: 'Fechar a barra lateral',
    hide: 'Esconder da barra lateral',
    customize: 'Personalizar barra lateral…',
    empty: 'Barra lateral vazia',
    emptyAction: 'Personalizar',
    section: 'Barra lateral',
    itemsTitle: 'Itens',
    itemsHelp: (palette) =>
      `Arraste para reordenar, ou use Alt+↑ e Alt+↓. Um item escondido continua na paleta de comandos (${palette}) e mantém o atalho. A mesma em todos os dispositivos sincronizados.`,
    zones: { top: 'Topo', middle: 'Meio', footer: 'Rodapé' },
    middleHelp: 'Rola junto com as páginas. Seus dois itens só trocam de lugar entre si.',
    show: (item) => `Mostrar ${item} na barra lateral`,
    moved: (item, place, count, zone) => `${item}, ${place} de ${count}, ${zone}`,
    restore: 'Restaurar padrão',
    restoreHelp: 'Todos os itens de volta, na ordem original.',
    saveFailed: 'Não foi possível salvar a barra lateral.',
    customizeCommand: 'Personalizar barra lateral…',
    openTrash: 'Abrir a Lixeira',
    openArchive: 'Abrir o Arquivo'
  }
}

/** Words that find the sidebar's commands in the palette, in both languages. */
export const SIDEBAR_KEYWORDS = [
  'sidebar',
  'barra lateral',
  'reorder',
  'reordenar',
  'hide',
  'esconder',
  'customize',
  'personalizar',
  'menu'
]

export function sidebarLocale(aiLanguage: unknown, systemLocale: string | undefined): SidebarLocale {
  if (isAiLanguage(aiLanguage)) return aiLanguage === 'pt-BR' ? 'pt-BR' : 'en'
  return typeof systemLocale === 'string' && /^pt\b/i.test(systemLocale) ? 'pt-BR' : 'en'
}
