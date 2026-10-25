import type { Page } from '@playwright/test'
import type { Repository } from '../../../src/main/db/repository'
import type { Op, PropertySchema } from '../../../src/shared/types'
import type { Scenario } from '../registry'
import { openPage, see } from '../ui'

/**
 * A database of its own beside the demo workspace, wide enough (eight columns) that a column added
 * at its end starts out of view: the menus of a database's columns (0.9.0, epic B) are shot on it.
 */
const DB = 'screens-db-reading'
const DB_NAME = 'Reading list'

const SCHEMA: Record<string, PropertySchema> = {
  title: { id: 'title', name: 'Name', type: 'title' },
  author: { id: 'author', name: 'Author', type: 'text' },
  status: {
    id: 'status',
    name: 'Status',
    type: 'select',
    options: [
      { id: 'reading', name: 'Reading', color: 'blue' },
      { id: 'next', name: 'Next', color: 'gray' },
      { id: 'read', name: 'Read', color: 'green' }
    ]
  },
  pages: { id: 'pages', name: 'Pages', type: 'number', numberFormat: 'number' },
  started: { id: 'started', name: 'Started', type: 'date' },
  owned: { id: 'owned', name: 'Owned', type: 'checkbox' },
  link: { id: 'link', name: 'Link', type: 'url' },
  notes: { id: 'notes', name: 'Notes', type: 'text' }
}

const BOOKS: { title: string; author: string; status: string; pages: number; owned: boolean }[] = [
  { title: 'Middlemarch', author: 'George Eliot', status: 'reading', pages: 880, owned: true },
  { title: 'Persuasion', author: 'Jane Austen', status: 'read', pages: 249, owned: true },
  { title: 'The Waves', author: 'Virginia Woolf', status: 'next', pages: 297, owned: false },
  { title: 'Bleak House', author: 'Charles Dickens', status: 'next', pages: 1017, owned: false }
]

function readingList(repo: Repository): void {
  const ops: Op[] = [
    {
      op: 'create',
      input: {
        id: DB,
        type: 'database',
        parentId: null,
        props: {
          title: [[DB_NAME]],
          icon: '📚',
          schema: SCHEMA,
          views: [
            { id: 'screens.view.reading', name: 'Table', type: 'table', visibleProperties: Object.keys(SCHEMA), filters: [], sorts: [] }
          ]
        }
      }
    },
    ...BOOKS.map<Op>((book, n) => ({
      op: 'create',
      input: {
        id: `${DB}-row-${n + 1}`,
        type: 'page',
        parentId: DB,
        props: {
          title: [[book.title]],
          values: { author: book.author, status: book.status, pages: book.pages, owned: book.owned }
        }
      }
    }))
  ]
  repo.apply(ops)
}

/**
 * The reading list with two more selects for the column menus of B3: Priority (three options)
 * and Stage (nine, one with a long name). Written as an update of the list's schema, so the
 * other scenarios' table stays as it is.
 */
function withSelects(repo: Repository): void {
  readingList(repo)
  const schema: Record<string, PropertySchema> = {
    ...SCHEMA,
    priority: {
      id: 'priority',
      name: 'Priority',
      type: 'select',
      options: [
        { id: 'high', name: 'High', color: 'red' },
        { id: 'medium', name: 'Medium', color: 'yellow' },
        { id: 'low', name: 'Low', color: 'gray' }
      ]
    },
    stage: {
      id: 'stage',
      name: 'Stage',
      type: 'select',
      options: [
        ['Inbox', 'gray'],
        ['Next', 'blue'],
        ['This week', 'green'],
        ['Someday', 'purple'],
        ['Blocked', 'red'],
        ['Delegated', 'orange'],
        ['Reference', 'brown'],
        ['Waiting on someone else to answer', 'yellow'],
        ['Done', 'green']
      ].map(([name, color], n) => ({ id: `stage-${n + 1}`, name, color }))
    }
  }
  const order = ['title', 'priority', 'stage', ...Object.keys(SCHEMA).filter((id) => id !== 'title')]
  repo.apply([
    {
      op: 'update',
      id: DB,
      patch: {
        props: {
          schema,
          views: [{ id: 'screens.view.reading', name: 'Table', type: 'table', visibleProperties: order, filters: [], sorts: [] }]
        }
      }
    }
  ])
}

/**
 * The reading list with a relation to itself (Similar) and a rollup over it (Similar pages), shown
 * right after the name: their column menus carry the longest of B3's translated labels.
 */
function withRelation(repo: Repository): void {
  readingList(repo)
  const schema: Record<string, PropertySchema> = {
    ...SCHEMA,
    similar: { id: 'similar', name: 'Similar', type: 'relation', relation: { databaseId: DB } },
    similarPages: {
      id: 'similarPages',
      name: 'Similar pages',
      type: 'rollup',
      rollup: { relationId: 'similar', propertyId: 'pages', function: 'sum' }
    }
  }
  const order = ['title', 'similar', 'similarPages', ...Object.keys(SCHEMA).filter((id) => id !== 'title')]
  repo.apply([
    {
      op: 'update',
      id: DB,
      patch: {
        props: {
          schema,
          views: [{ id: 'screens.view.reading', name: 'Table', type: 'table', visibleProperties: order, filters: [], sorts: [] }]
        }
      }
    }
  ])
}

/** A column's header, clicked: its property menu opens under it, on the "Options" section (0.9.0: not in base). */
async function openColumnMenu(page: Page, column: string, header = 'Options'): Promise<void> {
  await openPage(page, DB_NAME)
  await see(page, 'Middlemarch')
  await page.locator('.db-th', { hasText: column }).first().click()
  await page.locator('.ui-popover .db-prop-menu').waitFor({ state: 'visible' })
  await page.locator('.db-option-section .ui-menu-header', { hasText: header }).waitFor({ state: 'visible', timeout: 5_000 })
}

/** A column's header, clicked by its exact name: its property menu opens under it. */
async function openMenuOf(page: Page, column: string): Promise<void> {
  await openPage(page, DB_NAME)
  await see(page, 'Middlemarch')
  await page
    .locator('.db-th')
    .filter({ has: page.locator('.db-th-name', { hasText: new RegExp(`^${column}$`) }) })
    .click()
  await page.locator('.ui-popover .db-prop-menu').waitFor({ state: 'visible' })
}

/**
 * From the keyboard onto a column's header (0.9.0, B2): the grid takes the focus (its first cell
 * active), ArrowRight `steps` times along the first row, then ArrowUp. A base without B2 never shows
 * a focused header ("not in base").
 */
async function headerFromKeyboard(page: Page, steps: number): Promise<void> {
  await openPage(page, DB_NAME)
  await see(page, 'Middlemarch')
  await page.getByRole('grid', { name: 'Table' }).focus()
  await page.locator('.db-td.is-focused').waitFor({ state: 'visible' })
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowUp')
  await page.locator('.db-th.is-focused').waitFor({ state: 'visible', timeout: 5_000 })
}

/** The table's "+" header, clicked: the add-property menu opens under it. */
async function openAddMenu(page: Page): Promise<void> {
  await openPage(page, DB_NAME)
  await see(page, 'Middlemarch')
  // By its class: its name is translated since 0.9.0 ("Adicionar uma propriedade" in pt-BR).
  await page.locator('.db-th.is-add').click()
  await page.locator('.ui-popover [role="menu"]').waitFor({ state: 'visible' })
}

/** Types into the add menu's name field (0.9.0: a base without the field fails here, "not in base"). */
async function typeName(page: Page, label: string, name: string): Promise<void> {
  const field = page.getByRole('textbox', { name: label })
  await field.waitFor({ state: 'visible', timeout: 5_000 })
  await field.fill(name)
}

export default [
  {
    id: 'add-property-empty',
    description: 'The table\'s "+" menu just opened: the name field focused, the types below, no hint',
    workspace: readingList,
    run: async (page) => {
      await openAddMenu(page)
    }
  },
  {
    id: 'add-property-typed',
    description: 'The table\'s "+" menu with "Budget" typed in the name field: the hint shown under it',
    workspace: readingList,
    run: async (page) => {
      await openAddMenu(page)
      await typeName(page, 'Property name', 'Budget')
      await see(page, 'Enter adds a text property')
    }
  },
  {
    id: 'add-property-pt',
    description: 'The same menu with "Orçamento" typed, in pt-BR: the field, the hint and the types in Portuguese',
    locale: 'pt-BR',
    workspace: readingList,
    run: async (page) => {
      await openAddMenu(page)
      await typeName(page, 'Nome da propriedade', 'Orçamento')
      await see(page, 'Enter cria como texto')
    }
  },
  {
    id: 'add-property-added',
    description: 'After Enter with "Budget": the new column scrolled into view, its first cell the active one',
    workspace: readingList,
    run: async (page) => {
      await openAddMenu(page)
      await typeName(page, 'Property name', 'Budget')
      await page.keyboard.press('Enter')
      await page.locator('.ui-popover').waitFor({ state: 'detached' })
      await page.locator('.db-th', { hasText: 'Budget' }).waitFor({ state: 'visible' })
      await page.locator('.db-td.is-focused').waitFor({ state: 'visible' })
    }
  },
  {
    id: 'property-menu-options',
    description: "The Priority column's menu: the name field, its Options (High, Medium, Low) and the add field, then the rest of the menu",
    workspace: withSelects,
    run: async (page) => {
      await openColumnMenu(page, 'Priority')
      await see(page, 'Medium')
    }
  },
  {
    id: 'property-menu-options-moved',
    description: 'The same list from the keyboard: Tab into it, ArrowDown twice, Alt+ArrowUp; Low moved up and focused',
    workspace: withSelects,
    run: async (page) => {
      await openColumnMenu(page, 'Priority')
      await page.keyboard.press('Tab')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Alt+ArrowUp')
      await page.locator('.db-option-row:nth-child(2) .db-option-button:focus', { hasText: 'Low' }).waitFor({ state: 'visible' })
    }
  },
  {
    id: 'property-menu-options-long',
    description: 'A select with nine options: the list scrolls inside itself (End pressed in it), one long name ends in an ellipsis',
    workspace: withSelects,
    run: async (page) => {
      await openColumnMenu(page, 'Stage')
      await page.keyboard.press('Tab')
      await page.keyboard.press('End')
      await page.locator('.db-option-button:focus', { hasText: 'Done' }).waitFor({ state: 'visible' })
    }
  },
  {
    id: 'property-menu-option-edit',
    description: "An option opened from the Priority column's menu: its edit pane in the same popover, with Back",
    workspace: withSelects,
    run: async (page) => {
      await openColumnMenu(page, 'Priority')
      await page.locator('.db-option-button', { hasText: 'Medium' }).click()
      await page.locator('.ui-popover .db-option-edit').waitFor({ state: 'visible' })
    }
  },
  {
    id: 'table-header-focus',
    description: "ArrowUp from the first row's Author cell: the Author header active, with the grid's focus ring",
    workspace: readingList,
    run: async (page) => {
      await headerFromKeyboard(page, 1)
    }
  },
  {
    id: 'property-menu-insert',
    description: 'Enter on the Author header: its menu, name focused, with Insert left and Insert right under Type',
    workspace: readingList,
    run: async (page) => {
      await headerFromKeyboard(page, 1)
      await page.keyboard.press('Enter')
      await see(page, 'Insert left')
    }
  },
  {
    id: 'property-menu-insert-pt',
    description: 'The same menu in pt-BR: Inserir à esquerda, Inserir à direita',
    locale: 'pt-BR',
    workspace: readingList,
    run: async (page) => {
      await headerFromKeyboard(page, 1)
      await page.keyboard.press('Enter')
      await see(page, 'Inserir à esquerda')
    }
  },
  {
    id: 'property-menu-insert-added',
    description: 'Insert left on Author, "Year" typed, Enter: Year sits between Name and Author, its first cell active',
    workspace: readingList,
    run: async (page) => {
      await headerFromKeyboard(page, 1)
      await page.keyboard.press('Enter')
      await see(page, 'Insert left')
      await page.getByRole('menuitem', { name: 'Insert left' }).click()
      await typeName(page, 'Property name', 'Year')
      await page.keyboard.press('Enter')
      await page.locator('.ui-popover').waitFor({ state: 'detached' })
      await page.locator('.db-th:nth-of-type(3)', { hasText: 'Year' }).waitFor({ state: 'visible' })
      await page.locator('.db-td.is-focused').waitFor({ state: 'visible' })
    }
  },
  {
    id: 'property-menu-relation-pt',
    description: "A relation's column menu in pt-BR: Relacionada a, Limite and the long Duas vias line in the 240 px menu",
    locale: 'pt-BR',
    workspace: withRelation,
    run: async (page) => {
      await openMenuOf(page, 'Similar')
      await see(page, 'Limite: sem limite')
    }
  },
  {
    id: 'property-menu-rollup-pt',
    description: "A rollup's column menu in pt-BR: Relação, Propriedade, Calcular: Soma and Linhas",
    locale: 'pt-BR',
    workspace: withRelation,
    run: async (page) => {
      await openMenuOf(page, 'Similar pages')
      await see(page, 'Calcular: Soma')
    }
  },
  {
    id: 'property-menu-options-pt',
    description: "The Priority column's menu in pt-BR: Opções, Adicionar uma opção and every entry in Portuguese",
    locale: 'pt-BR',
    workspace: withSelects,
    run: async (page) => {
      await openColumnMenu(page, 'Priority', 'Opções')
      await see(page, 'Excluir propriedade')
    }
  }
] satisfies Scenario[]
