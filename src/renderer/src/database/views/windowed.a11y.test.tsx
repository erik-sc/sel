// @vitest-environment happy-dom
// Long board columns, lists and galleries draw only what is near the viewport. The keyboard still
// reaches every card: the focused one and each column's Tab stop are always drawn, and a card the
// arrows go to is drawn before it takes the focus.
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '@shared/types'
import { cleanup, fakeApi, press, render, seriousViolations } from '@/a11y/testing'
import type { ViewProps } from '../common'
import { BoardView } from './BoardView'
import { GalleryView } from './GalleryView'
import { ListView } from './ListView'

beforeAll(() => {
  ;(window as unknown as { api: unknown }).api = fakeApi()
})

afterEach(cleanup)

const status: PropertySchema = {
  id: 'status',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'todo', name: 'To do', color: 'gray' },
    { id: 'done', name: 'Done', color: 'green' }
  ]
}
const schema: Record<string, PropertySchema> = { title: { id: 'title', name: 'Name', type: 'title' }, status }

function view(type: DatabaseView['type']): DatabaseView {
  return { id: 'v', name: 'Tasks', type, visibleProperties: ['title'], filters: [], sorts: [], groupBy: 'status' }
}

function row(i: number, state: string): Block {
  return {
    id: `r${i}`,
    type: 'page',
    parentId: 'db-1',
    content: [],
    props: { title: [[`Task ${i}`]], values: { status: state } },
    createdAt: 0,
    updatedAt: 0,
    trashedAt: null
  }
}

/** 600 to-dos and 2 done ones. */
const ROWS = [...Array.from({ length: 600 }, (_, i) => row(i, 'todo')), row(600, 'done'), row(601, 'done')]

function props(type: DatabaseView['type'], rows = ROWS): ViewProps {
  return {
    databaseId: 'db-1',
    schema,
    view: view(type),
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

const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-card-id]')]
const focused = (): string | undefined => (document.activeElement as HTMLElement | null)?.dataset.cardId

describe('a windowed board', () => {
  it('draws part of a long column, with each card saying where it is', async () => {
    await render(<BoardView {...props('board')} />)
    const drawn = cards()
    expect(drawn.length).toBeGreaterThan(2)
    expect(drawn.length).toBeLessThan(200)
    const first = drawn.find((card) => card.dataset.cardId === 'r0') as HTMLElement
    expect(first.getAttribute('aria-posinset')).toBe('1')
    expect(first.getAttribute('aria-setsize')).toBe('600')
    expect(first.tabIndex).toBe(0)
    // The short column is drawn whole.
    expect(drawn.some((card) => card.dataset.cardId === 'r601')).toBe(true)
    expect(await seriousViolations()).toEqual([])
  })

  it('reaches every card with the arrows, Home and End, and keeps the focused one drawn', async () => {
    await render(<BoardView {...props('board')} />)
    const first = document.querySelector<HTMLElement>('[data-card-id="r0"]') as HTMLElement
    await act(async () => first.focus())
    await press(first, 'End')
    expect(focused()).toBe('r599')
    const last = document.activeElement as HTMLElement
    expect(last.getAttribute('aria-posinset')).toBe('600')
    expect(last.tabIndex).toBe(0)
    await press(last, 'ArrowUp')
    expect(focused()).toBe('r598')
    // Across to the other column and back, at about the same height (its last card).
    await press(document.activeElement as HTMLElement, 'ArrowRight')
    expect(focused()).toBe('r601')
    await press(document.activeElement as HTMLElement, 'ArrowLeft')
    expect(focused()).toBe('r1')
    await press(document.activeElement as HTMLElement, 'Home')
    expect(focused()).toBe('r0')
    // Far down, then the arrows one by one.
    for (let i = 0; i < 5; i++) await press(document.activeElement as HTMLElement, 'ArrowDown')
    expect(focused()).toBe('r5')
  })

  it('opens the menu of a card reached far down the column', async () => {
    const opened: string[] = []
    await render(<BoardView {...props('board')} onRowMenu={(_event, id) => opened.push(id)} />)
    const first = document.querySelector<HTMLElement>('[data-card-id="r0"]') as HTMLElement
    await act(async () => first.focus())
    await press(first, 'End')
    await press(document.activeElement as HTMLElement, 'F10', { shiftKey: true })
    expect(opened).toEqual(['r599'])
  })
})

describe('windowed lists and galleries', () => {
  it('a list draws part of its rows, and always the one being edited', async () => {
    const container = await render(<ListView {...props('list')} editingRowId="r590" />)
    const rows = container.querySelectorAll('.db-list-row')
    expect(rows.length).toBeLessThan(200)
    expect(container.querySelector('.db-list-row input, .db-list-row [contenteditable]')).not.toBeNull()
    expect(container.querySelector('.db-window-spacer')).not.toBeNull()
  })

  it('a gallery draws whole grid rows near the viewport, its New card at the end', async () => {
    const container = await render(<GalleryView {...props('gallery')} />)
    expect(container.querySelectorAll('.db-gallery-card').length).toBeLessThan(200)
    const short = await render(<GalleryView {...props('gallery', ROWS.slice(0, 10))} />)
    expect(short.querySelectorAll('.db-gallery-card')).toHaveLength(11)
    expect(short.querySelector('.db-window-spacer')).toBeNull()
  })
})
