import { describe, expect, it } from 'vitest'
import { NOTEBOOK_ID } from '../../shared/notebook'
import type { BlockProps } from '../../shared/types'
import type { TaskBlock } from '../briefing/tasks'
import { collectDay } from './review'

const FROM = new Date(2026, 9, 15).getTime()
const TO = new Date(2026, 9, 16).getTime() - 1
const today = (hour: number): number => FROM + hour * 3_600_000
const yesterday = FROM - 3_600_000

function block(id: string, type: TaskBlock['type'], parentId: string | null, props: BlockProps, updatedAt: number, trashedAt: number | null = null): TaskBlock {
  return { id, type, parentId, props, updatedAt, trashedAt }
}

const checkboxDb = block('db-check', 'database', null, { title: [['Chores']], schema: { title: { id: 'title', name: 'Name', type: 'title' }, done: { id: 'done', name: 'Done', type: 'checkbox' } } }, yesterday)
const statusDb = block(
  'db-status',
  'database',
  null,
  {
    title: [['Work']],
    schema: {
      title: { id: 'title', name: 'Name', type: 'title' },
      status: { id: 'status', name: 'Status', type: 'select', options: [{ id: 'todo', name: 'To do', color: 'gray' }, { id: 'ok', name: 'Done', color: 'green' }, { id: 'no', name: 'Cancelled', color: 'red' }] }
    }
  },
  yesterday
)
const notesDb = block('db-notes', 'database', null, { title: [['Reading notes']], schema: { title: { id: 'title', name: 'Name', type: 'title' } } }, yesterday)
const row = (id: string, db: TaskBlock, values: Record<string, unknown>, at: number, title = id): TaskBlock => block(id, 'page', db.id, { title: [[title]], values: values as BlockProps['values'] }, at)

describe('what happened today', () => {
  it('lists the tasks done today, by any signal, the most recent first', () => {
    const blocks = [
      checkboxDb,
      statusDb,
      row('swept', checkboxDb, { done: true }, today(9), 'Sweep the stairs'),
      row('shipped', statusDb, { status: 'ok' }, today(15), 'Ship the release'),
      row('dropped', statusDb, { status: 'no' }, today(16), 'Cancelled thing'),
      row('open', statusDb, { status: 'todo' }, today(17), 'Still open'),
      row('old', checkboxDb, { done: true }, yesterday, 'Done yesterday'),
      block('page', 'page', null, { title: [['Diary']] }, today(10)),
      block('todo-1', 'to_do', 'page', { title: [['Water the plants']], checked: true }, today(11)),
      block('todo-2', 'to_do', 'page', { title: [['Not yet']], checked: false }, today(12))
    ]
    const { completed } = collectDay(blocks, { from: FROM, to: TO })
    expect(completed).toEqual([
      { id: 'shipped', title: 'Ship the release', pageId: 'shipped' },
      { id: 'todo-1', title: 'Water the plants', pageId: 'page' },
      { id: 'swept', title: 'Sweep the stairs', pageId: 'swept' }
    ])
  })

  it('lists the pages edited today, not the task rows, the notebook or what is in the trash', () => {
    const blocks = [
      statusDb,
      notesDb,
      block('a', 'page', null, { title: [['Morning pages']] }, today(8)),
      block('b', 'page', 'a', { title: [['A sub-page']] }, today(13)),
      block('c', 'page', null, { title: [['Last week']] }, yesterday),
      block('gone', 'page', null, { title: [['Thrown away']] }, today(14), today(14)),
      block('inside', 'page', 'gone', { title: [['In the trash']] }, today(14)),
      row('book', notesDb, {}, today(9), 'A book I read'),
      row('task', statusDb, { status: 'todo' }, today(9)),
      block(NOTEBOOK_ID, 'page', null, { title: [['Ink notebook']], system: 'notebook' }, today(20)),
      block(`${NOTEBOOK_ID}-2026-10-15`, 'text', NOTEBOOK_ID, { title: [['a line']] }, today(20)),
      block('untitled', 'page', null, {}, today(7))
    ]
    const { edited } = collectDay(blocks, { from: FROM, to: TO })
    expect(edited.map((item) => item.title)).toEqual(['A sub-page', 'A book I read', 'Morning pages', 'Untitled'])
  })

  it('keeps each list short', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => block(`p${i}`, 'page', null, { title: [[`Page ${i}`]] }, today(1) + i))
    expect(collectDay(blocks, { from: FROM, to: TO }).edited).toHaveLength(8)
    expect(collectDay(blocks, { from: FROM, to: TO, cap: 3 }).edited.map((item) => item.id)).toEqual(['p19', 'p18', 'p17'])
  })

  it('reads damaged blocks without failing', () => {
    const blocks = [block('x', 'page', null, { title: 'not rich text' as never }, today(1)), { id: 7 } as never, null as never, block('y', 'to_do', 'nowhere', { title: [['orphan']], checked: true }, today(2))]
    expect(collectDay(blocks, { from: FROM, to: TO })).toEqual({ completed: [], edited: [{ id: 'x', title: 'Untitled', pageId: 'x' }] })
  })
})
