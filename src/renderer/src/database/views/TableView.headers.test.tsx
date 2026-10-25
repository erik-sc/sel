// @vitest-environment happy-dom
// The table's headers from the keyboard (0.9.0, B2): ArrowUp from the first row reaches the
// column's header, the arrows, Home and End move along the headers to "+", Enter, Space, F2 or the
// Menu key open the property menu with its name focused, Escape there comes back to the header;
// and "Insert left / right" in that menu adds a property on that side of the column, in one write.
import { act } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, DatabaseView, Op, PropertySchema } from '@shared/types'
import { PAGE_KEYS } from '@shared/shortcuts'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from '@/a11y/testing'
import { invertOps } from '@/editor/ops'
import { useHome } from '@/home/store'
import { applyOps, getBlock, putBlocks, useBlock } from '@/store/blocks'

vi.mock('../lazyParts', () => ({
  PartFallback: () => null,
  RelationTargetPicker: ({ onPick }: { onPick: (id: string) => void }) => (
    <button type="button" data-testid="pick-target" onClick={() => onPick('db')}>
      Books
    </button>
  ),
  FormulaEditor: () => null
}))

import * as L from '../logic'
import { PropertyMenu } from '../propertyMenus'
import { SHORTCUT_GROUPS } from '../../shortcuts/catalog'
import { TableView } from './TableView'

/** Every batch the store sends to main, to count the writes an action makes. */
const writes: Op[][] = []

beforeAll(() => {
  const api = fakeApi() as { blocks: Record<string, unknown> }
  const blocks = new Proxy(api.blocks, {
    get: (target, key) =>
      key === 'apply'
        ? (ops: Op[]) => {
            writes.push(ops)
            return Promise.resolve([])
          }
        : Reflect.get(target, key)
  })
  ;(window as unknown as { api: unknown }).api = new Proxy(api, {
    get: (target, key) => (key === 'blocks' ? blocks : Reflect.get(target, key))
  })
})

const VIEW: DatabaseView = {
  id: 'view-1',
  name: 'Reading list',
  type: 'table',
  visibleProperties: ['title', 'author', 'pages'],
  filters: [],
  sorts: []
}

function database(content: string[]): Block {
  return {
    id: 'db',
    type: 'database',
    parentId: null,
    content,
    props: {
      title: [['Reading list']],
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        author: { id: 'author', name: 'Author', type: 'text' },
        pages: { id: 'pages', name: 'Pages', type: 'number' }
      },
      views: [VIEW]
    },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

function row(id: string, title: string): Block {
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: [[title]], values: {} },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

/** A table that draws what the store holds, as the database block does. */
function Table(): JSX.Element {
  const block = useBlock('db')
  const { schema, views } = L.normalizeDatabase(block)
  const rows = L.contentOf(block)
    .map((id) => getBlock(id))
    .filter((b): b is Block => !!b)
  return (
    <TableView
      databaseId="db"
      schema={schema}
      view={views[0]}
      rows={rows}
      inline={false}
      canReorder
      editingRowId={null}
      setEditingRowId={() => undefined}
      onOpen={() => undefined}
      onRowMenu={() => undefined}
      onNewRow={() => 'new'}
      onAddFilter={() => undefined}
    />
  )
}

beforeEach(() => {
  useHome.setState({ locale: 'en' })
  writes.length = 0
  putBlocks([database(['r1', 'r2']), row('r1', 'Middlemarch'), row('r2', 'Persuasion')])
})

afterEach(cleanup)

const grid = (): HTMLElement => document.querySelector('[role="grid"]') as HTMLElement
const active = (): HTMLElement | null => document.getElementById(grid().getAttribute('aria-activedescendant') ?? '')
const nameField = (): HTMLInputElement | null => document.querySelector('.ui-popover .db-prop-menu-name input')
const item = (label: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === label)
const viewOrder = (): string[] => L.normalizeDatabase(getBlock('db')).views[0].visibleProperties
const schemaNow = (): Record<string, PropertySchema> => L.normalizeDatabase(getBlock('db')).schema

/** Renders the table and puts the keyboard on the first row's cell of `column` (0 = Name). */
async function onFirstRow(column = 0): Promise<void> {
  await render(<Table />)
  await act(async () => grid().focus())
  for (let i = 0; i < column; i++) await press(grid(), 'ArrowRight')
}

async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the headers from the keyboard', () => {
  it('reaches the column’s header with ArrowUp from the first row, and Enter opens its menu with the name focused', async () => {
    await onFirstRow(1)
    await press(grid(), 'ArrowUp')
    expect(active()?.getAttribute('role')).toBe('columnheader')
    expect(active()?.textContent).toBe('Author')
    // The grid's focus ring, and no cell drawn as focused beside it.
    expect(active()?.classList.contains('is-focused')).toBe(true)
    expect(document.querySelector('.db-td.is-focused')).toBeNull()
    expect(await seriousViolations()).toEqual([])
    await press(grid(), 'Enter')
    await settle()
    expect(document.activeElement).toBe(nameField())
    expect(nameField()?.value).toBe('Author')
    expect(await seriousViolations()).toEqual([])
  })

  it('opens the menu with F2 too (rename), and with Space and Shift+F10', async () => {
    await onFirstRow(2)
    await press(grid(), 'ArrowUp')
    await press(grid(), 'F2')
    await settle()
    expect(document.activeElement).toBe(nameField())
    expect(nameField()?.value).toBe('Pages')
    await press(nameField() as HTMLElement, 'Escape')
    await settle()
    await press(grid(), ' ')
    await settle()
    expect(nameField()?.value).toBe('Pages')
    await press(nameField() as HTMLElement, 'Escape')
    await settle()
    await press(grid(), 'F10', { shiftKey: true })
    await settle()
    expect(nameField()?.value).toBe('Pages')
  })

  it('comes back to the same header on Escape in the menu', async () => {
    await onFirstRow(1)
    await press(grid(), 'ArrowUp')
    await press(grid(), 'Enter')
    await settle()
    await press(nameField() as HTMLElement, 'Escape')
    await settle()
    expect(nameField()).toBeNull()
    expect(document.activeElement).toBe(grid())
    expect(active()?.textContent).toBe('Author')
  })

  it('moves along the headers with the arrows, Home and End, ending on "+", which opens the add menu', async () => {
    await onFirstRow(0)
    await press(grid(), 'ArrowUp')
    await press(grid(), 'ArrowRight')
    expect(active()?.textContent).toBe('Author')
    await press(grid(), 'End')
    expect(active()?.getAttribute('role')).toBe('columnheader')
    expect(active()?.querySelector('button')?.getAttribute('aria-label')).toBe('Add a property')
    expect(document.querySelector('.db-th.is-add')?.classList.contains('is-focused')).toBe(true)
    // Nothing past "+", nothing before the first.
    await press(grid(), 'ArrowRight')
    expect(active()?.querySelector('.db-th.is-add')).toBeTruthy()
    await press(grid(), 'Home')
    expect(active()?.textContent).toBe('Name')
    await press(grid(), 'ArrowLeft')
    expect(active()?.textContent).toBe('Name')
    await press(grid(), 'End')
    await press(grid(), 'Enter')
    await settle()
    expect(document.querySelector('.ui-popover .db-add-prop-menu')).toBeTruthy()
  })

  it('goes back down to the first row of the column with ArrowDown', async () => {
    await onFirstRow(1)
    await press(grid(), 'ArrowUp')
    await press(grid(), 'ArrowRight')
    await press(grid(), 'ArrowDown')
    expect(active()?.getAttribute('role')).toBe('gridcell')
    expect(active()?.getAttribute('aria-colindex')).toBe('4')
    expect(active()?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('2')
    expect(document.querySelector('.db-th.is-focused')).toBeNull()
  })

  it('lists F2 on a header among the page keys and on the shortcuts screen', () => {
    expect(PAGE_KEYS.find((key) => key.key === 'f2' && !key.ctrl && !key.shift && !key.alt)?.where).toContain('table headers')
    const databases = SHORTCUT_GROUPS.find((group) => group.id === 'databases')?.entries ?? []
    expect(databases.find((entry) => entry.id === 'db-header-menu')?.keys).toContain('F2')
    expect(databases.find((entry) => entry.id === 'db-header')?.keys).toEqual(['Up'])
  })

  it('keeps the header active on Escape, with no menu to close', async () => {
    await onFirstRow(1)
    await press(grid(), 'ArrowUp')
    await press(grid(), 'Escape')
    expect(active()?.textContent).toBe('Author')
    expect(active()?.classList.contains('is-focused')).toBe(true)
  })

  it('starts on the first header when the table has no rows', async () => {
    putBlocks([database([])])
    await render(<Table />)
    await act(async () => grid().focus())
    expect(active()?.textContent).toBe('Name')
  })
})

/** Opens the menu of the header named `name` from the keyboard. */
async function headerMenu(name: string): Promise<void> {
  const schema = schemaNow()
  const index = viewOrder().findIndex((id) => schema[id]?.name === name)
  await onFirstRow(index)
  await press(grid(), 'ArrowUp')
  await press(grid(), 'Enter')
  await settle()
}

describe('Insert left and Insert right', () => {
  it('sit under Type, before the sort entries, after a separator', async () => {
    await headerMenu('Author')
    const labels = [...document.querySelectorAll<HTMLElement>('.ui-popover [role="menuitem"]')].map((el) => el.textContent)
    const at = (label: string): number => labels.indexOf(label)
    expect(at('Insert left')).toBe(at('Type: Text') + 1)
    expect(at('Insert right')).toBe(at('Insert left') + 1)
    expect(at('Sort ascending')).toBe(at('Insert right') + 1)
    const left = item('Insert left') as HTMLElement
    expect(left.previousElementSibling?.classList.contains('ui-menu-separator')).toBe(true)
    expect(await seriousViolations()).toEqual([])
  })

  it('come after a relation’s own settings, so Type and those stay together', async () => {
    putBlocks([
      {
        ...database(['r1', 'r2']),
        props: {
          ...database([]).props,
          schema: {
            ...database([]).props.schema,
            similar: { id: 'similar', name: 'Similar', type: 'relation', relation: { databaseId: 'db' } }
          },
          views: [{ ...VIEW, visibleProperties: ['title', 'similar', 'author', 'pages'] }]
        }
      }
    ])
    await headerMenu('Similar')
    const labels = [...document.querySelectorAll<HTMLElement>('.ui-popover [role="menuitem"]')].map((el) => el.textContent ?? '')
    const at = (start: string): number => labels.findIndex((label) => label.startsWith(start))
    expect(at('Related to:')).toBe(at('Type: Relation') + 1)
    expect(at('Insert left')).toBeGreaterThan(at('Two-way'))
    expect(at('Sort ascending')).toBe(at('Insert right') + 1)
  })

  it('adds a property between the first and second columns from the second one’s Insert left, in one write that one undo reverses', async () => {
    await headerMenu('Author')
    const before = getBlock('db') as Block
    await act(async () => item('Insert left')?.click())
    await settle()
    // The same header now holds the add menu, its name field focused.
    const field = document.querySelector('.ui-popover .db-add-prop-menu input') as HTMLInputElement
    expect(document.activeElement).toBe(field)
    writes.length = 0
    await type(field, 'Year')
    await press(field, 'Enter')
    await settle()
    const added = Object.values(schemaNow()).find((p) => p.name === 'Year') as PropertySchema
    expect(added.type).toBe('text')
    expect(viewOrder()).toEqual(['title', added.id, 'author', 'pages'])
    expect([...document.querySelectorAll('.db-th .db-th-name')].map((el) => el.textContent)).toEqual(['Name', 'Year', 'Author', 'Pages'])
    // Its first cell is the active one, as after "+".
    expect(active()?.getAttribute('aria-colindex')).toBe('3')
    expect(active()?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('2')
    // One write: schema and order together. Its inverse (what undo applies) takes both back.
    expect(writes).toHaveLength(1)
    const { inverse } = invertOps(writes[0], (id) => (id === 'db' ? before : getBlock(id)))
    await act(async () => {
      await applyOps(inverse)
    })
    expect(Object.keys(schemaNow()).sort()).toEqual(['author', 'pages', 'title'])
    expect(viewOrder()).toEqual(['title', 'author', 'pages'])
  })

  it('adds on the right of a column, and at the end from the last one', async () => {
    await headerMenu('Name')
    await act(async () => item('Insert right')?.click())
    await settle()
    let field = document.querySelector('.ui-popover .db-add-prop-menu input') as HTMLInputElement
    await type(field, 'Year')
    await act(async () => item('Number')?.click())
    await settle()
    const year = Object.values(schemaNow()).find((p) => p.name === 'Year') as PropertySchema
    expect(year.type).toBe('number')
    expect(viewOrder()).toEqual(['title', year.id, 'author', 'pages'])
    await cleanup()

    await headerMenu('Pages')
    await act(async () => item('Insert right')?.click())
    await settle()
    field = document.querySelector('.ui-popover .db-add-prop-menu input') as HTMLInputElement
    await type(field, 'Notes')
    await press(field, 'Enter')
    await settle()
    const notes = Object.values(schemaNow()).find((p) => p.name === 'Notes') as PropertySchema
    expect(viewOrder()).toEqual(['title', year.id, 'author', 'pages', notes.id])
  })

  it('gives the focus back to the grid, on the same header, when the add menu is closed with Escape', async () => {
    await headerMenu('Author')
    await act(async () => item('Insert left')?.click())
    await settle()
    const field = document.querySelector('.ui-popover .db-add-prop-menu input') as HTMLInputElement
    await press(field, 'Escape')
    await settle()
    expect(document.querySelector('.ui-popover')).toBeNull()
    expect(Object.keys(schemaNow()).sort()).toEqual(['author', 'pages', 'title'])
    expect(document.activeElement).toBe(grid())
    expect(active()?.textContent).toBe('Author')
  })

  it('places a relation on that side too', async () => {
    await headerMenu('Author')
    await act(async () => item('Insert left')?.click())
    await settle()
    await act(async () => item('Relation')?.click())
    await settle()
    await act(async () => (document.querySelector('[data-testid="pick-target"]') as HTMLElement).click())
    const relation = Object.values(schemaNow()).find((p) => p.type === 'relation') as PropertySchema
    expect(viewOrder()).toEqual(['title', relation.id, 'author', 'pages'])
  })

  it('keeps a rename typed before choosing Insert', async () => {
    await headerMenu('Author')
    await type(nameField() as HTMLInputElement, 'Writer')
    await act(async () => item('Insert right')?.click())
    await settle()
    expect(schemaNow().author.name).toBe('Writer')
    expect(document.querySelector('.ui-popover .db-add-prop-menu')).toBeTruthy()
  })

  it('makes the new header the active one when the table has no rows', async () => {
    putBlocks([database([])])
    await render(<Table />)
    await act(async () => grid().focus())
    await press(grid(), 'ArrowRight')
    await press(grid(), 'Enter')
    await settle()
    await act(async () => item('Insert left')?.click())
    await settle()
    const field = document.querySelector('.ui-popover .db-add-prop-menu input') as HTMLInputElement
    await type(field, 'Year')
    await press(field, 'Enter')
    await settle()
    expect(document.activeElement).toBe(grid())
    expect(active()?.textContent).toBe('Year')
  })

  it('reads in pt-BR', async () => {
    useHome.setState({ locale: 'pt-BR' })
    await headerMenu('Author')
    expect(item('Inserir à esquerda')).toBeTruthy()
    expect(item('Inserir à direita')).toBeTruthy()
  })

  it('are not offered outside a table (a row’s page)', async () => {
    const anchor = document.createElement('button')
    document.body.append(anchor)
    await render(<PropertyMenu databaseId="db" prop={schemaNow().author} anchor={anchor} onClose={() => undefined} />)
    await settle()
    expect(item('Type: Text')).toBeTruthy()
    expect(item('Insert left')).toBeUndefined()
    expect(item('Insert right')).toBeUndefined()
  })
})
