// @vitest-environment happy-dom
// A table header edited where it is: the name becomes a field in the header (click on the header
// the keyboard is on, double click, F2; Enter saves, Escape restores) and the type glyph opens only
// the choice of type, which warns before a conversion that empties cells and otherwise offers Undo.
import { act } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block, DatabaseView, Op, PropertySchema } from '@shared/types'
import { cleanup, fakeApi, press, render, settle } from '@/a11y/testing'
import { useHome } from '@/home/store'
import { getBlock, putBlocks, useBlock } from '@/store/blocks'
import { useToasts } from '@/ui/toast'

vi.mock('../lazyParts', () => ({
  PartFallback: () => null,
  RelationTargetPicker: () => null,
  FormulaEditor: () => null
}))

import * as L from '../logic'
import { TableView } from './TableView'

beforeAll(() => {
  const api = fakeApi() as { blocks: Record<string, unknown> }
  const blocks = new Proxy(api.blocks, {
    get: (target, key) => (key === 'apply' ? (_ops: Op[]) => Promise.resolve([]) : Reflect.get(target, key))
  })
  ;(window as unknown as { api: unknown }).api = new Proxy(api, {
    get: (target, key) => (key === 'blocks' ? blocks : Reflect.get(target, key))
  })
})

const VIEW: DatabaseView = {
  id: 'view-1',
  name: 'Reading list',
  type: 'table',
  visibleProperties: ['title', 'status'],
  filters: [],
  sorts: []
}

const OPTIONS = [
  { id: 'reading', name: 'reading', color: 'green' },
  { id: 'later', name: 'later', color: 'blue' }
]

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
        status: { id: 'status', name: 'Status', type: 'select', options: OPTIONS }
      },
      views: [VIEW]
    },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

function row(id: string, title: string, values: Record<string, string>): Block {
  return {
    id,
    type: 'page',
    parentId: 'db',
    content: [],
    props: { title: [[title]], values },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

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
  useToasts.setState({ toasts: [] })
  putBlocks([database(['r1', 'r2']), row('r1', 'Middlemarch', { status: 'reading' }), row('r2', 'Persuasion', { status: 'later' })])
})

afterEach(cleanup)

const grid = (): HTMLElement => document.querySelector('[role="grid"]') as HTMLElement
const headers = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.db-thead [role="columnheader"].db-th')]
const statusHeader = (): HTMLElement => headers()[1]
const field = (): HTMLInputElement | null => document.querySelector('.db-th-input')
const schemaNow = (): Record<string, PropertySchema> => L.normalizeDatabase(getBlock('db')).schema
const cellOf = (rowId: string): unknown => (getBlock(rowId)?.props.values as Record<string, unknown>).status
const menuItem = (label: string): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes(label))

async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

/** The keyboard on the Status header. */
async function onStatusHeader(): Promise<void> {
  await render(<Table />)
  await act(async () => grid().focus())
  await press(grid(), 'ArrowRight')
  await press(grid(), 'ArrowUp')
}

describe('renaming in the header', () => {
  it('F2 turns the name into a field with the name selected; Enter saves it, with no menu open', async () => {
    await onStatusHeader()
    await press(grid(), 'F2')
    await settle()
    expect(field()?.value).toBe('Status')
    expect(document.activeElement).toBe(field())
    expect(document.querySelector('.ui-popover')).toBeNull()
    await type(field() as HTMLInputElement, 'State')
    await press(field() as HTMLInputElement, 'Enter')
    await settle()
    expect(field()).toBeNull()
    expect(schemaNow().status.name).toBe('State')
    expect(statusHeader().textContent).toBe('State')
  })

  it('Escape restores the name and writes nothing', async () => {
    await onStatusHeader()
    await press(grid(), 'F2')
    await type(field() as HTMLInputElement, 'State')
    await press(field() as HTMLInputElement, 'Escape')
    await settle()
    expect(field()).toBeNull()
    expect(schemaNow().status.name).toBe('Status')
    expect(statusHeader().textContent).toBe('Status')
  })

  it('a double click renames; a click on a header the keyboard is not on opens the menu as before', async () => {
    await render(<Table />)
    await click(statusHeader())
    await settle()
    expect(document.querySelector('.ui-popover')).not.toBeNull()
    expect(field()).toBeNull()
    await cleanup()
    await render(<Table />)
    await act(async () => {
      statusHeader().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    await settle()
    expect(field()?.value).toBe('Status')
  })

  it('a click on the header the keyboard is on renames it', async () => {
    await onStatusHeader()
    await click(statusHeader())
    await settle()
    expect(field()?.value).toBe('Status')
    expect(document.querySelector('.ui-popover')).toBeNull()
  })

  it('Enter on the header still opens the menu, for sort, filter and hide', async () => {
    await onStatusHeader()
    await press(grid(), 'Enter')
    await settle()
    expect(document.querySelector('.db-prop-menu')).not.toBeNull()
    expect(field()).toBeNull()
  })

  it('the title column can be renamed too', async () => {
    await render(<Table />)
    await act(async () => grid().focus())
    await press(grid(), 'ArrowUp')
    await press(grid(), 'F2')
    await type(field() as HTMLInputElement, 'Book')
    await press(field() as HTMLInputElement, 'Enter')
    await settle()
    expect(schemaNow().title.name).toBe('Book')
  })
})

describe('the type glyph', () => {
  it('opens only the choice of type, named for the column', async () => {
    await render(<Table />)
    const glyph = statusHeader().querySelector('button.db-th-type') as HTMLElement
    expect(glyph.getAttribute('aria-label')).toBe('Type of Status: Select. Change')
    await click(glyph)
    await settle()
    expect(document.querySelector('.ui-popover')?.getAttribute('aria-label')).toBe('Type of Status')
    expect(menuItem('Number')).toBeDefined()
    expect(menuItem('Sort ascending')).toBeUndefined()
  })

  it('the title column has no glyph button: its type is fixed', async () => {
    await render(<Table />)
    expect(headers()[0].querySelector('button.db-th-type')).toBeNull()
    expect(headers()[0].querySelector('.db-th-icon')?.getAttribute('title')).toBe('Title: fixed type')
  })

  it('a conversion that empties cells warns first, and Cancel changes nothing', async () => {
    await render(<Table />)
    await click(statusHeader().querySelector('button.db-th-type') as HTMLElement)
    await settle()
    expect(menuItem('Number')?.textContent).toContain('2 values lost')
    await click(menuItem('Number') as HTMLElement)
    await settle()
    expect(document.querySelector('.db-type-confirm-text')?.textContent).toBe('2 cells have no counterpart as Number and will be emptied.')
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel') as HTMLElement
    await click(cancel)
    await settle()
    expect(schemaNow().status.type).toBe('select')
    expect(cellOf('r1')).toBe('reading')
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('Convert applies it and the toast’s Undo puts the type and the cells back', async () => {
    await render(<Table />)
    await click(statusHeader().querySelector('button.db-th-type') as HTMLElement)
    await settle()
    await click(menuItem('Number') as HTMLElement)
    await settle()
    const convert = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Convert') as HTMLElement
    await click(convert)
    await settle()
    expect(schemaNow().status.type).toBe('number')
    expect(cellOf('r1')).toBeUndefined()
    const [toast] = useToasts.getState().toasts
    expect(toast.message).toBe('Status is now Number.')
    expect(toast.action?.label).toBe('Undo')
    await act(async () => toast.action?.run())
    await settle()
    expect(schemaNow().status.type).toBe('select')
    expect(schemaNow().status.options).toEqual(OPTIONS)
    expect(cellOf('r1')).toBe('reading')
    expect(cellOf('r2')).toBe('later')
  })

  it('a conversion that keeps every value applies at once, with an Undo toast in the home’s language', async () => {
    useHome.setState({ locale: 'pt-BR' })
    await render(<Table />)
    await click(statusHeader().querySelector('button.db-th-type') as HTMLElement)
    await settle()
    await click(menuItem('Texto') as HTMLElement)
    await settle()
    expect(schemaNow().status.type).toBe('text')
    expect(cellOf('r1')).toBe('reading')
    const [toast] = useToasts.getState().toasts
    expect(toast.message).toBe('Status agora é Texto.')
    expect(toast.action?.label).toBe('Desfazer')
  })
})
