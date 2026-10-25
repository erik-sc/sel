// The words of the database menus, in English and in Brazilian Portuguese, in the language of
// the home (the language set for AI answers when it is one of the two, else the system's), as
// dateCopy.ts does for the date picker. Only the menus translated so far are here; the rest of
// the database UI is still English (planned for 0.11.0). The table of words is plain data; the
// two readers below pick it by the home's locale.
import type { PropertyType, RollupFunction } from '@shared/types'
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
  /** A property's own menu (its column header, or its line on a row's page). */
  propertyMenu: {
    nameLabel: string
    /** "Type: Select". */
    type: (type: string) => string
    numberFormat: string
    numberFormats: { number: string; percent: string; currency: string }
    editFormula: string
    sortAscending: string
    sortDescending: string
    filter: string
    hide: string
    deleteProperty: string
    /** A relation: where it points, how many pages, and the other side. */
    relatedTo: (name: string) => string
    deletedDatabase: string
    chooseDatabase: string
    inTrash: string
    limitOne: string
    limitNone: string
    noLimit: string
    onePage: string
    twoWayHere: string
    twoWayOn: (name: string) => string
    untitled: string
    /** A rollup: which relation, which property, how, and which rows. */
    relation: (name: string) => string
    property: (name: string) => string
    none: string
    addRelationFirst: string
    calculate: (fn: string) => string
    functions: Record<RollupFunction, string>
    rows: (rule: string) => string
    allRows: string
    allLinkedRows: string
    nothingToKeepBy: string
    checked: string
    unchecked: string
  }
  /** The options of a select, in its property menu (0.9.0, B3). */
  options: {
    header: string
    add: string
    /** The drag handle's name. */
    move: (name: string) => string
    back: string
    moved: (name: string, position: number, total: number) => string
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
    },
    propertyMenu: {
      nameLabel: 'Property name',
      type: (type) => `Type: ${type}`,
      numberFormat: 'Number format',
      numberFormats: { number: 'Number', percent: 'Percent', currency: 'Currency' },
      editFormula: 'Edit formula…',
      sortAscending: 'Sort ascending',
      sortDescending: 'Sort descending',
      filter: 'Filter',
      hide: 'Hide in view',
      deleteProperty: 'Delete property',
      relatedTo: (name) => `Related to: ${name}`,
      deletedDatabase: 'a deleted database',
      chooseDatabase: 'Choose a database…',
      inTrash: 'In the trash',
      limitOne: 'Limit: 1 page',
      limitNone: 'Limit: no limit',
      noLimit: 'No limit',
      onePage: '1 page',
      twoWayHere: 'Two-way: show the other side here too',
      twoWayOn: (name) => `Two-way: show on ${name}`,
      untitled: 'Untitled',
      relation: (name) => `Relation: ${name}`,
      property: (name) => `Property: ${name}`,
      none: 'none',
      addRelationFirst: 'Add a relation first',
      calculate: (fn) => `Calculate: ${fn}`,
      functions: {
        show_original: 'Show original',
        count: 'Count all',
        count_values: 'Count values',
        count_unique: 'Count unique values',
        sum: 'Sum',
        average: 'Average',
        min: 'Min',
        max: 'Max',
        range: 'Range',
        earliest: 'Earliest date',
        latest: 'Latest date',
        percent_checked: 'Percent checked'
      },
      rows: (rule) => `Rows: ${rule}`,
      allRows: 'All',
      allLinkedRows: 'All linked rows',
      nothingToKeepBy: 'Nothing to keep rows by',
      checked: 'checked',
      unchecked: 'unchecked'
    },
    options: {
      header: 'Options',
      add: 'Add an option',
      move: (name) => `Move ${name}`,
      back: 'Back',
      moved: (name, position, total) => `${name}, position ${position} of ${total}`,
      added: (name) => `${name} added`
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
    },
    propertyMenu: {
      nameLabel: 'Nome da propriedade',
      type: (type) => `Tipo: ${type}`,
      numberFormat: 'Formato do número',
      numberFormats: { number: 'Número', percent: 'Porcentagem', currency: 'Moeda' },
      editFormula: 'Editar fórmula…',
      sortAscending: 'Ordenar crescente',
      sortDescending: 'Ordenar decrescente',
      filter: 'Filtrar',
      // Not "nesta visualização": 26 characters are cut at the menu's 240 px.
      hide: 'Ocultar na visualização',
      deleteProperty: 'Excluir propriedade',
      relatedTo: (name) => `Relacionada a: ${name}`,
      deletedDatabase: 'um banco de dados excluído',
      chooseDatabase: 'Escolher um banco de dados…',
      inTrash: 'Na lixeira',
      limitOne: 'Limite: 1 página',
      limitNone: 'Limite: sem limite',
      noLimit: 'Sem limite',
      onePage: '1 página',
      twoWayHere: 'Duas vias: mostrar o outro lado aqui também',
      twoWayOn: (name) => `Duas vias: mostrar em ${name}`,
      untitled: 'Sem título',
      relation: (name) => `Relação: ${name}`,
      property: (name) => `Propriedade: ${name}`,
      none: 'nenhuma',
      addRelationFirst: 'Adicione uma relação antes',
      calculate: (fn) => `Calcular: ${fn}`,
      functions: {
        show_original: 'Mostrar original',
        count: 'Contar todos',
        count_values: 'Contar valores',
        count_unique: 'Contar valores únicos',
        sum: 'Soma',
        average: 'Média',
        min: 'Mínimo',
        max: 'Máximo',
        range: 'Intervalo',
        earliest: 'Data mais antiga',
        latest: 'Data mais recente',
        percent_checked: 'Porcentagem marcada'
      },
      rows: (rule) => `Linhas: ${rule}`,
      allRows: 'Todas',
      allLinkedRows: 'Todas as linhas ligadas',
      nothingToKeepBy: 'Nada para filtrar as linhas',
      checked: 'marcada',
      unchecked: 'desmarcada'
    },
    options: {
      header: 'Opções',
      add: 'Adicionar uma opção',
      move: (name) => `Mover ${name}`,
      back: 'Voltar',
      moved: (name, position, total) => `${name}, posição ${position} de ${total}`,
      added: (name) => `Opção ${name} adicionada`
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
