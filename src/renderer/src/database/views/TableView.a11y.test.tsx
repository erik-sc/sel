// @vitest-environment happy-dom
// The table as a screen reader meets it: a grid of rows and gridcells under named column headers,
// whose focused cell is the grid's active descendant, and nothing serious for axe.
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '@shared/types'
import { cleanup, fakeApi, press, render, seriousViolations } from '@/a11y/testing'
import type { ViewProps } from '../common'
import { TableView } from './TableView'

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi()
})

afterEach(cleanup)

const schema: Record<string, PropertySchema> = {
  title: { id: 'title', name: 'Name', type: 'title' },
  status: { id: 'status', name: 'Status', type: 'select', options: [{ id: 'todo', name: 'To do', color: 'gray' }] },
  done: { id: 'done', name: 'Done', type: 'checkbox' }
}

const view: DatabaseView = {
  id: 'view-1',
  name: 'Reading list',
  type: 'table',
  visibleProperties: ['title', 'status', 'done'],
  filters: [],
  sorts: []
}

function row(id: string, title: string): Block {
  return {
    id,
    type: 'page',
    parentId: 'db-1',
    content: [],
    props: { title: [[title]], values: { status: 'todo', done: false } },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

function props(rows: Block[]): ViewProps {
  return {
    databaseId: 'db-1',
    schema,
    view,
    rows,
    inline: false,
    canReorder: true,
    editingRowId: null,
    setEditingRowId: () => undefined,
    onOpen: () => undefined,
    onRowMenu: () => undefined,
    onNewRow: () => 'new',
    onAddFilter: () => undefined
  }
}

describe('the table', () => {
  it('is a named grid of rows and cells, and axe finds nothing serious', async () => {
    await render(<TableView {...props([row('r1', 'Middlemarch'), row('r2', 'Persuasion')])} />)
    const grid = document.querySelector('[role="grid"]') as HTMLElement
    expect(grid.getAttribute('aria-label')).toBe('Reading list')
    expect(grid.getAttribute('aria-rowcount')).toBe('3')
    const rows = grid.querySelectorAll('[role="row"]')
    expect(rows).toHaveLength(3)
    expect([...rows[0].querySelectorAll('[role="columnheader"]')].map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Name', 'Status', 'Done'])
    )
    expect(rows[1].getAttribute('aria-rowindex')).toBe('2')
    expect(rows[1].querySelectorAll('[role="gridcell"]').length).toBeGreaterThanOrEqual(3)
    expect(await seriousViolations()).toEqual([])
  })

  it('points at the focused cell as the arrows move', async () => {
    await render(<TableView {...props([row('r1', 'Middlemarch'), row('r2', 'Persuasion')])} />)
    const grid = document.querySelector('[role="grid"]') as HTMLElement
    // Tab arrives on the grid: its first cell is the active one at once.
    await act(async () => grid.focus())
    const cell = (): HTMLElement | null => document.getElementById(grid.getAttribute('aria-activedescendant') ?? '')
    expect(cell()?.getAttribute('role')).toBe('gridcell')
    expect(cell()?.textContent).toContain('Middlemarch')
    await press(grid, 'ArrowDown')
    expect(cell()?.textContent).toContain('Persuasion')
    await press(grid, 'ArrowRight')
    expect(cell()?.getAttribute('aria-colindex')).toBe('3')
    expect(cell()?.closest('[role="row"]')?.getAttribute('aria-rowindex')).toBe('3')
  })

  it('opens the row menu with the Menu key', async () => {
    const opened: string[] = []
    await render(
      <TableView
        {...props([row('r1', 'Middlemarch')])}
        onRowMenu={(_event, id, from) => opened.push(`${id}:${from?.getAttribute('role')}`)}
      />
    )
    const grid = document.querySelector('[role="grid"]') as HTMLElement
    await act(async () => grid.focus())
    await press(grid, 'F10', { shiftKey: true })
    expect(opened).toEqual(['r1:gridcell'])
  })
})
