import { describe, expect, it } from 'vitest'
import { NOTEBOOK_ID } from '@shared/notebook'
import { TASKS_DATABASE_ID } from '@shared/tasks'
import type { ActivitySummary } from '@shared/activity'
import type { Block } from '@shared/types'
import {
  activityNote,
  doneThisWeek,
  editedThisWeek,
  focusCandidates,
  liveFocus,
  type ReviewTask,
  slidThisWeek,
  weekBounds,
  weekDigest
} from './steps'

const PAST = { start: '2026-10-19', end: '2026-10-25' }
const NEXT = { start: '2026-10-26', end: '2026-11-01' }
const WORK = { id: 'p-work', name: 'Work', color: 'blue' }
const HOME = { id: 'p-home', name: 'Home', color: 'green' }

let order = 0
const task = (id: string, extra: Partial<ReviewTask> = {}): ReviewTask => ({
  id,
  title: id,
  done: false,
  due: null,
  priority: null,
  project: null,
  completedAt: null,
  recurring: false,
  parent: null,
  order: order++,
  createdAt: order,
  ...extra
})

describe('what got done', () => {
  it('lists the tasks completed in the week by project, the Inbox last, in the order they were done', () => {
    const tasks = [
      task('inbox', { done: true, completedAt: '2026-10-20T09:00' }),
      task('b', { done: true, project: WORK, completedAt: '2026-10-22T10:00' }),
      task('a', { done: true, project: WORK, completedAt: '2026-10-21T10:00' }),
      task('h', { done: true, project: HOME, completedAt: '2026-10-25T22:00' }),
      task('repeat', { recurring: true, project: HOME, completedAt: '2026-10-23T08:00', due: '2026-10-30' }),
      task('before', { done: true, completedAt: '2026-10-18T23:00' }),
      task('reopened', { done: false, completedAt: '2026-10-21T10:00' })
    ]
    expect(doneThisWeek(tasks, PAST).map((group) => [group.project?.name ?? null, group.tasks.map((t) => t.id)])).toEqual([
      ['Work', ['a', 'b']],
      ['Home', ['repeat', 'h']],
      [null, ['inbox']]
    ])
  })

  it('lists the pages edited in the week, not tasks, Meditations or the trash', () => {
    const { from, to } = weekBounds(PAST)
    const page = (id: string, updatedAt: number, extra: Partial<Block> = {}): Block =>
      ({
        id,
        type: 'page',
        parentId: null,
        props: { title: [[id]] },
        content: [],
        updatedAt,
        createdAt: 0,
        trashedAt: null,
        ...extra
      }) as Block
    const pages = [
      page('old', from - 1),
      page('row', from + 10, { parentId: TASKS_DATABASE_ID }),
      page(NOTEBOOK_ID, from + 10),
      page('gone', from + 10, { trashedAt: 5 }),
      page('db', from + 10, { type: 'database' }),
      page('first', from + 10),
      page('last', to - 10)
    ]
    expect(editedThisWeek(pages, { from, to })).toEqual([
      { id: 'last', title: 'last' },
      { id: 'first', title: 'first' }
    ])
  })

  it('adds days with activity and focus sessions from the log, and nothing when it is empty', () => {
    const summary = {
      total: 9,
      byDay: [
        { day: '2026-10-20', count: 4 },
        { day: '2026-10-21', count: 5 }
      ],
      byKind: { 'focus.finish': 3 }
    }
    expect(activityNote(summary as unknown as ActivitySummary)).toEqual({ days: 2, focus: 3 })
    expect(activityNote({ ...summary, total: 0 } as unknown as ActivitySummary)).toBeNull()
    expect(activityNote(null)).toBeNull()
  })
})

describe('what slid', () => {
  it('holds the open tasks due in the week up to today, the earliest first', () => {
    const tasks = [
      task('wed', { due: '2026-10-21' }),
      task('mon', { due: '2026-10-19T09:00' }),
      task('today', { due: '2026-10-23' }),
      task('sat', { due: '2026-10-24' }),
      task('done', { due: '2026-10-20', done: true }),
      task('earlier', { due: '2026-10-12' }),
      task('none')
    ]
    expect(slidThisWeek(tasks, PAST, '2026-10-23').map((t) => t.id)).toEqual(['mon', 'wed', 'today'])
    // On the Monday after, the whole week is behind.
    expect(slidThisWeek(tasks, PAST, '2026-10-26').map((t) => t.id)).toEqual(['mon', 'wed', 'today', 'sat'])
  })
})

describe('the week to come', () => {
  it('offers what is chosen, next actions, what is due, then by priority; open top-level tasks only', () => {
    const tasks = [
      task('plain'),
      task('p1', { priority: 1 }),
      task('due', { due: '2026-10-28' }),
      task('later', { due: '2026-11-20' }),
      task('next'),
      task('chosen'),
      task('sub', { parent: 'plain' }),
      task('closed', { done: true })
    ]
    const ids = focusCandidates(tasks, NEXT, { chosen: ['chosen'], nextActions: new Set(['next']) }).map((t) => t.id)
    expect(ids).toEqual(['chosen', 'next', 'due', 'later', 'p1', 'plain'])
    expect(focusCandidates(tasks, NEXT, { query: 'PL' }).map((t) => t.id)).toEqual(['plain'])
  })

  it('forgets a chosen task once it is closed or gone', () => {
    expect(liveFocus(['a', 'gone', 'b'], [task('a'), task('b', { done: true })])).toEqual(['a'])
  })

  it('sums the week up for the close, with titles and no score', () => {
    const tasks = [task('a', { title: 'Write' }), task('b', { title: 'Call' })]
    const digest = weekDigest({
      past: PAST,
      next: NEXT,
      done: [{ project: null, tasks: [{ id: 'x', title: 'Done thing', at: '2026-10-20' }] }],
      edited: [{ id: 'p', title: 'Notes' }],
      slid: [tasks[0]],
      inbox: 2,
      withoutNext: 1,
      focus: ['b', 'gone'],
      tasks,
      note: ' calm week '
    })
    expect(digest).toEqual({
      past: PAST,
      next: NEXT,
      done: ['Done thing'],
      edited: 1,
      left: 1,
      inbox: 2,
      withoutNext: 1,
      focus: ['Call'],
      note: 'calm week'
    })
  })
})
