// @vitest-environment happy-dom
// Adding a property with its name (0.9.0, B1): the add menu opens on a name field, a type picked
// or Enter adds the property under that name, an empty field names it after its type in the
// home's language, and in a table the new column's first cell becomes the active one.
import { act } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '@shared/types'
import { cleanup, fakeApi, press, render, seriousViolations, settle } from '@/a11y/testing'
import { useHome } from '@/home/store'
import { putBlocks, useBlock, getBlock } from '@/store/blocks'

// The relation picker and the formula editor are lazy parts with their own tests: stand-ins here
// show what the menu hands them.
vi.mock('./lazyParts', () => ({
  PartFallback: () => null,
  RelationTargetPicker: ({ onPick }: { onPick: (id: string) => void }) => (
    <button type="button" data-testid="pick-target" onClick={() => onPick('books')}>
      Books
    </button>
  ),
  FormulaEditor: ({ prop }: { prop: PropertySchema }) => <div data-testid="formula-editor">{prop.name}</div>
}))

import { AddPropertyMenu } from './propertyMenus'
import { TableView } from './views/TableView'
import * as L from './logic'

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi({ 'blocks.apply': [] })
})

const view: DatabaseView = { id: 'view-1', name: 'Projects', type: 'table', visibleProperties: ['title'], filters: [], sorts: [] }

function database(id: string, title: string, content: string[] = []): Block {
  return {
    id,
    type: 'database',
    parentId: null,
    content,
    props: { title: [[title]], schema: { title: { id: 'title', name: 'Name', type: 'title' } }, views: [{ ...view, id: `${id}-view` }] },
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

const schemaOf = (): PropertySchema[] => Object.values(L.normalizeDatabase(getBlock('db')).schema)
const added = (): PropertySchema[] => schemaOf().filter((p) => p.type !== 'title')

beforeEach(() => {
  useHome.setState({ locale: 'en' })
  putBlocks([database('db', 'Projects'), database('books', 'Books')])
})

afterEach(cleanup)

const field = (): HTMLInputElement => document.querySelector('.db-add-prop-menu input') as HTMLInputElement
const menu = (): HTMLElement => document.querySelector('.db-add-prop-menu [role="menu"]') as HTMLElement
const item = (label: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === label) as HTMLElement

async function type(text: string): Promise<void> {
  await act(async () => {
    const input = field()
    // React tracks the value it last set: go around it, as a user's typing does.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** The live region is filled a moment after `announce()`. */
const said = (): Promise<void> => act(() => new Promise<void>((resolve) => setTimeout(resolve, 80)))

async function openMenu(onClose = vi.fn(), onAdded?: (id: string) => void): Promise<typeof onClose> {
  const anchor = document.createElement('button')
  anchor.textContent = 'Add a property'
  document.body.append(anchor)
  await render(<AddPropertyMenu databaseId="db" viewId="db-view" anchor={anchor} onClose={onClose} onAdded={onAdded} />)
  await settle()
  return onClose
}

describe('the add-property menu', () => {
  it('opens on a focused name field, with the types below and no hint, and axe finds nothing serious', async () => {
    await openMenu()
    expect(document.activeElement).toBe(field())
    expect(field().placeholder).toBe('Property name')
    expect(field().getAttribute('aria-label')).toBe('Property name')
    expect(document.querySelector('.ui-menu-header')?.textContent).toBe('Type')
    expect(item('Number')).toBeTruthy()
    expect(document.querySelector('.db-add-prop-hint')).toBeNull()
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Add a property')
    expect(await seriousViolations()).toEqual([])
  })

  it('shows the hint once a name is typed, and the name never filters the types', async () => {
    await openMenu()
    await type('Budget')
    const hint = document.querySelector('.db-add-prop-hint') as HTMLElement
    expect(hint.textContent).toBe('Enter adds a text property')
    expect(field().getAttribute('aria-describedby')).toBe(hint.id)
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(L.PROPERTY_TYPES.length)
    expect(await seriousViolations()).toEqual([])
  })

  it('adds a Number property named "Budget" when Budget is typed and Number picked', async () => {
    const onClose = await openMenu()
    await type('Budget')
    await act(async () => item('Number').click())
    expect(added()).toEqual([expect.objectContaining({ name: 'Budget', type: 'number' })])
    // Shown in the view it was added from.
    expect(L.normalizeDatabase(getBlock('db')).views[0].visibleProperties).toContain(added()[0].id)
    expect(onClose).toHaveBeenCalled()
  })

  it('adds a Text property "Notes" on Enter in the field, and says so', async () => {
    const onAdded = vi.fn()
    const onClose = await openMenu(vi.fn(), onAdded)
    await type('Notes')
    await press(field(), 'Enter')
    expect(added()).toEqual([expect.objectContaining({ name: 'Notes', type: 'text' })])
    expect(onAdded).toHaveBeenCalledWith(added()[0].id)
    expect(onClose).toHaveBeenCalled()
    await said()
    expect(document.querySelector('[data-announcer]')?.textContent).toBe('Added Notes')
  })

  it('names the property after its type in pt-BR when the field is empty', async () => {
    useHome.setState({ locale: 'pt-BR' })
    await openMenu()
    expect(field().placeholder).toBe('Nome da propriedade')
    expect(document.querySelector('.ui-menu-header')?.textContent).toBe('Tipo')
    await act(async () => item('Número').click())
    expect(added()).toEqual([expect.objectContaining({ name: 'Número', type: 'number' })])
    await said()
    expect(document.querySelector('[data-announcer]')?.textContent).toBe('Propriedade Número adicionada')
  })

  it('reads its hint in pt-BR too', async () => {
    useHome.setState({ locale: 'pt-BR' })
    await openMenu()
    await type('Orçamento')
    expect(document.querySelector('.db-add-prop-hint')?.textContent).toBe('Enter cria como texto')
  })

  it('moves into the list on Enter with an empty field, never adding an unnamed Text', async () => {
    await openMenu()
    await press(field(), 'Enter')
    expect(added()).toEqual([])
    expect(document.activeElement).toBe(menu())
    expect(menu().getAttribute('aria-activedescendant')).toBe(item('Text').id)
  })

  it('goes into the list with ArrowDown and back to the field with ArrowUp on the first type', async () => {
    await openMenu()
    await type('Budget')
    await press(field(), 'ArrowDown')
    expect(document.activeElement).toBe(menu())
    expect(menu().getAttribute('aria-activedescendant')).toBe(item('Text').id)
    await press(menu(), 'ArrowDown')
    expect(menu().getAttribute('aria-activedescendant')).toBe(item('Number').id)
    await press(menu(), 'ArrowUp')
    await press(menu(), 'ArrowUp')
    expect(document.activeElement).toBe(field())
    expect(field().value).toBe('Budget')
    expect(field().selectionStart).toBe('Budget'.length)
    expect(menu().getAttribute('aria-activedescendant')).toBeNull()
    // Back in the list, Enter adds the active type with the typed name.
    await press(field(), 'ArrowDown')
    await press(menu(), 'ArrowDown')
    await press(menu(), 'Enter')
    expect(added()).toEqual([expect.objectContaining({ name: 'Budget', type: 'number' })])
  })

  it('closes on Escape and adds nothing', async () => {
    const onClose = await openMenu()
    await type('Budget')
    await press(field(), 'Escape')
    expect(onClose).toHaveBeenCalled()
    expect(added()).toEqual([])
  })

  it('keeps a typed name over the related database title on the relation path', async () => {
    await openMenu()
    await type('Reading')
    await act(async () => item('Relation').click())
    await settle()
    await act(async () => (document.querySelector('[data-testid="pick-target"]') as HTMLElement).click())
    expect(added()).toEqual([
      expect.objectContaining({ name: 'Reading', type: 'relation', relation: expect.objectContaining({ databaseId: 'books' }) })
    ])
  })

  it('names a relation after its database when nothing is typed, as before', async () => {
    await openMenu()
    await act(async () => item('Relation').click())
    await settle()
    await act(async () => (document.querySelector('[data-testid="pick-target"]') as HTMLElement).click())
    expect(added()).toEqual([expect.objectContaining({ name: 'Books', type: 'relation' })])
  })

  it('opens the formula editor on a formula named as typed', async () => {
    const onClose = await openMenu()
    await type('Margin')
    await act(async () => item('Formula').click())
    await settle()
    expect(document.querySelector('[data-testid="formula-editor"]')?.textContent).toBe('Margin')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('gives a name that exists already a number, as before (uniqueName)', async () => {
    await openMenu()
    await type('Name')
    await press(field(), 'Enter')
    expect(added()).toEqual([expect.objectContaining({ name: 'Name 1', type: 'text' })])
  })
})

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

describe('adding from the table header', () => {
  it('makes the new column’s first cell the active one, so the next key edits it', async () => {
    putBlocks([database('db', 'Projects', ['r1', 'r2']), row('r1', 'Kitchen'), row('r2', 'Garden')])
    const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    await render(<Table />)
    const plus = document.querySelector('.db-th.is-add') as HTMLElement
    await act(async () => plus.click())
    await settle()
    await type('Budget')
    await press(field(), 'Enter')
    await settle()
    const prop = added()[0]
    expect(prop).toEqual(expect.objectContaining({ name: 'Budget', type: 'text' }))
    const grid = document.querySelector('[role="grid"]') as HTMLElement
    expect(document.activeElement).toBe(grid)
    const active = document.getElementById(grid.getAttribute('aria-activedescendant') ?? '')
    expect(active?.closest('[data-cell]')?.getAttribute('data-cell') ?? active?.getAttribute('data-cell')).toContain(prop.id)
    expect(active?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('2')
    const header = document.querySelector(`[data-prop-id="${prop.id}"]`)
    expect(scrolled.mock.contexts).toContain(header)
    scrolled.mockRestore()
  })

  it('leaves the focus on "+" when there are no rows', async () => {
    await render(<Table />)
    const plus = document.querySelector('.db-th.is-add') as HTMLElement
    plus.focus()
    await act(async () => plus.click())
    await settle()
    await type('Budget')
    await press(field(), 'Enter')
    await settle()
    expect(added()).toEqual([expect.objectContaining({ name: 'Budget' })])
    expect(document.activeElement).toBe(plus)
  })
})
