// The editor's words that have been translated, in English and in Brazilian Portuguese, in the
// language of the home (home/copy.ts). The rest of the editor's menus are English for now
// (planned for 0.11.0); new words go here.
import { useHome } from '@/home/store'
import type { HomeLocale } from '@/home/copy'

export interface EditorCopy {
  /** The block menu's entry that puts a block in the row of the one before it. */
  placeBeside: string
  /** The block menu's entry that takes a block out of its row, below the one before it. */
  placeBelow: string
  /** Said after the block was placed beside the one before it. */
  placedBeside: string
  /** Said after the block was placed below the one before it. */
  placedBelow: string
  /**
   * The name of a row of blocks side by side, for screen readers; also the slash item that makes
   * one ("2 columns"), and what is said once it is made.
   */
  columns: (count: number) => string
  /** The slash item's hint under "2 columns" and "3 columns". */
  columnsHint: (count: number) => string
}

const COUNT_EN: Readonly<Record<number, string>> = { 2: 'Two', 3: 'Three', 4: 'Four' }
const COUNT_PT: Readonly<Record<number, string>> = { 2: 'Dois', 3: 'Três', 4: 'Quatro' }

export const EDITOR_COPY: Record<HomeLocale, EditorCopy> = {
  en: {
    placeBeside: 'Place beside the previous block',
    placeBelow: 'Place below the previous block',
    placedBeside: 'Placed beside',
    placedBelow: 'Placed below',
    columns: (count) => `${count} columns`,
    columnsHint: (count) => `${COUNT_EN[count] ?? count} blocks side by side`
  },
  'pt-BR': {
    placeBeside: 'Colocar ao lado do bloco anterior',
    placeBelow: 'Colocar abaixo do bloco anterior',
    placedBeside: 'Colocado ao lado',
    placedBelow: 'Colocado abaixo',
    columns: (count) => `${count} colunas`,
    columnsHint: (count) => `${COUNT_PT[count] ?? count} blocos lado a lado`
  }
}

/** The words in the language the home is in, read when they are needed. */
export function editorCopy(): EditorCopy {
  return EDITOR_COPY[useHome.getState().locale]
}

export function useEditorCopy(): EditorCopy {
  return EDITOR_COPY[useHome((state) => state.locale)]
}
