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
  /** The name of a row of blocks side by side, for screen readers. */
  columns: (count: number) => string
}

export const EDITOR_COPY: Record<HomeLocale, EditorCopy> = {
  en: {
    placeBeside: 'Place beside the previous block',
    placeBelow: 'Place below the previous block',
    placedBeside: 'Placed beside',
    placedBelow: 'Placed below',
    columns: (count) => `${count} columns`
  },
  'pt-BR': {
    placeBeside: 'Colocar ao lado do bloco anterior',
    placeBelow: 'Colocar abaixo do bloco anterior',
    placedBeside: 'Colocado ao lado',
    placedBelow: 'Colocado abaixo',
    columns: (count) => `${count} colunas`
  }
}

/** The words in the language the home is in, read when they are needed. */
export function editorCopy(): EditorCopy {
  return EDITOR_COPY[useHome.getState().locale]
}

export function useEditorCopy(): EditorCopy {
  return EDITOR_COPY[useHome((state) => state.locale)]
}
