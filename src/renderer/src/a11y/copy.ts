// What the screen reader hears from the app itself, in English and in Brazilian Portuguese: the
// kind of each block, and what a keyboard move did. Chosen like the home's words (home/copy.ts).
// Pure: no React, no DOM.
import type { BlockType } from '../../../shared/types'
import type { HomeLocale } from '../home/copy'

export interface A11yCopy {
  /** `aria-roledescription` of a block's text: what kind of block it is. */
  block: Partial<Record<BlockType, string>>
  movedUp: string
  movedDown: string
  indented: string
  outdented: string
  /** After blocks were deleted with the keyboard. */
  deleted: (count: number) => string
  /** A page moved in the sidebar: where it is now. */
  pageMoved: (position: number, total: number) => string
  pageInside: (parent: string) => string
  /** A tab moved along the strip. */
  tabMoved: (position: number, total: number) => string
  /** A card moved to another group of a board. */
  cardMoved: (group: string) => string
  /** An event moved to another day of a calendar. */
  eventMoved: (day: string) => string
  /** The slash menu's list. */
  blocksMenu: string
  /** The toolbar over selected text. */
  toolbar: string
}

const EN: A11yCopy = {
  block: {
    text: 'Text',
    heading_1: 'Heading 1',
    heading_2: 'Heading 2',
    heading_3: 'Heading 3',
    bulleted_list: 'Bulleted list item',
    numbered_list: 'Numbered list item',
    to_do: 'To-do',
    toggle: 'Toggle',
    quote: 'Quote',
    callout: 'Callout'
  },
  movedUp: 'Moved up',
  movedDown: 'Moved down',
  indented: 'Indented',
  outdented: 'Outdented',
  deleted: (count) => (count === 1 ? 'Block deleted' : `${count} blocks deleted`),
  pageMoved: (position, total) => `Moved to ${position} of ${total}`,
  pageInside: (parent) => `Moved inside ${parent}`,
  tabMoved: (position, total) => `Tab ${position} of ${total}`,
  cardMoved: (group) => `Moved to ${group}`,
  eventMoved: (day) => `Moved to ${day}`,
  blocksMenu: 'Blocks',
  toolbar: 'Formatting'
}

const PT: A11yCopy = {
  block: {
    text: 'Texto',
    heading_1: 'Título 1',
    heading_2: 'Título 2',
    heading_3: 'Título 3',
    bulleted_list: 'Item de lista',
    numbered_list: 'Item de lista numerada',
    to_do: 'Tarefa',
    toggle: 'Recolhível',
    quote: 'Citação',
    callout: 'Destaque'
  },
  movedUp: 'Movido para cima',
  movedDown: 'Movido para baixo',
  indented: 'Indentado',
  outdented: 'Recuo removido',
  deleted: (count) => (count === 1 ? 'Bloco apagado' : `${count} blocos apagados`),
  pageMoved: (position, total) => `Movida para ${position} de ${total}`,
  pageInside: (parent) => `Movida para dentro de ${parent}`,
  tabMoved: (position, total) => `Aba ${position} de ${total}`,
  cardMoved: (group) => `Movido para ${group}`,
  eventMoved: (day) => `Movido para ${day}`,
  blocksMenu: 'Blocos',
  toolbar: 'Formatação'
}

export const A11Y_COPY: Record<HomeLocale, A11yCopy> = { en: EN, 'pt-BR': PT }
