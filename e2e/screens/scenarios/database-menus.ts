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

/** The table's "+" header, clicked: the add-property menu opens under it. */
async function openAddMenu(page: Page): Promise<void> {
  await openPage(page, DB_NAME)
  await see(page, 'Middlemarch')
  await page.getByRole('grid').getByRole('button', { name: 'Add a property' }).click()
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
  }
] satisfies Scenario[]
