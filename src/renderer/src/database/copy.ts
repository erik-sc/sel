// The words of the database menus, in English and in Brazilian Portuguese, in the language of
// the home (the language set for AI answers when it is one of the two, else the system's), as
// dateCopy.ts does for the date picker. Only the menus translated so far are here; the rest of
// the database UI is still English (planned for 0.11.0). The table of words is plain data; the
// two readers below pick it by the home's locale.
import type { PropertyType } from '@shared/types'
import type { HomeLocale } from '@/home/copy'
import { useHome } from '@/home/store'

export interface DatabaseCopy {
  /** A property type's name: in the add menu, and the name a new property gets when none is typed. */
  types: Record<PropertyType, string>
  addProperty: {
    /** The popover's name, for a screen reader. */
    label: string
    /** The name field's placeholder and label. */
    nameLabel: string
    /** Over the list of types. */
    typeHeader: string
    /** Under the field, once something is typed. */
    enterHint: string
    /** Said after the property is added. */
    added: (name: string) => string
  }
}

export const DATABASE_COPY: Record<HomeLocale, DatabaseCopy> = {
  en: {
    types: {
      title: 'Title',
      text: 'Text',
      number: 'Number',
      select: 'Select',
      multi_select: 'Multi-select',
      date: 'Date',
      checkbox: 'Checkbox',
      url: 'URL',
      created_time: 'Created time',
      last_edited_time: 'Last edited time',
      relation: 'Relation',
      rollup: 'Rollup',
      formula: 'Formula'
    },
    addProperty: {
      label: 'Add a property',
      nameLabel: 'Property name',
      typeHeader: 'Type',
      enterHint: 'Enter adds a text property',
      added: (name) => `Added ${name}`
    }
  },
  'pt-BR': {
    types: {
      title: 'Título',
      text: 'Texto',
      number: 'Número',
      select: 'Seleção única',
      multi_select: 'Seleção múltipla',
      date: 'Data',
      checkbox: 'Caixa de seleção',
      url: 'URL',
      created_time: 'Criado em',
      last_edited_time: 'Última edição',
      relation: 'Relação',
      rollup: 'Agregação',
      formula: 'Fórmula'
    },
    addProperty: {
      label: 'Adicionar uma propriedade',
      nameLabel: 'Nome da propriedade',
      typeHeader: 'Tipo',
      // Shorter than "Enter cria uma propriedade de texto", which wraps in the 240 px menu.
      enterHint: 'Enter cria como texto',
      added: (name) => `Propriedade ${name} adicionada`
    }
  }
}

/** The words in the language the home is in, read when they are needed (outside React). */
export function databaseCopy(): DatabaseCopy {
  return DATABASE_COPY[useHome.getState().locale]
}

export function useDatabaseCopy(): DatabaseCopy {
  return DATABASE_COPY[useHome((state) => state.locale)]
}
