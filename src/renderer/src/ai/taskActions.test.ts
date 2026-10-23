// The actions the routines propose (C2–C4): what is accepted from an answer, and what Apply
// writes. Pure: blocks in a map, ops out, applied with the same rules as the backend.
import { describe, expect, it } from 'vitest'
import { cleanAction, splitActions, TASK_ACTION_LIMITS } from '../../../shared/actions'
import { entryId, NOTEBOOK_ID } from '../../../shared/notebook'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../../shared/tasks'
import type { Block, BlockProps, BlockType } from '@shared/types'
import { invertOps } from '../editor/ops'
import { applyOpsToMap, type BlockMap } from '../store/ops'
import { actionTargets, describeAction, planActions, summarizeActions } from './actions'

function block(id: string, type: BlockType, props: BlockProps = {}, extra: Partial<Block> = {}): Block {
  return { id, type, parentId: null, content: [], props, createdAt: 1, updatedAt: 1, trashedAt: null, ...extra }
}

const TODAY = '2026-10-22'

function workspace(): BlockMap {
  const rows = [
    block('task-rep-0001', 'page', {
      title: [['Write the report']],
      values: { [TASK_PROPS.due]: '2026-10-21', [TASK_PROPS.project]: 'p-web' }
    }),
    block('task-bill-001', 'page', { title: [['Pay the bill']], values: { [TASK_PROPS.due]: '2026-10-20T09:00' } }),
    block('task-blk-0001', 'page', {
      title: [['Review']],
      values: { [TASK_PROPS.due]: { start: '2026-10-22T14:00', end: '2026-10-22T15:00' }, [TASK_PROPS.priority]: 'tasks.p3' }
    })
  ].map((row) => ({ ...row, parentId: TASKS_DATABASE_ID }))
  const map: BlockMap = {
    [TASKS_DATABASE_ID]: block(
      TASKS_DATABASE_ID,
      'database',
      { title: [['Tasks']], system: 'tasks' },
      { content: rows.map((row) => row.id) }
    ),
    'page-other-01': block('page-other-01', 'page', { title: [['Not a task']] })
  }
  for (const row of rows) map[row.id] = row
  return map
}

function env(map: BlockMap) {
  let n = 0
  return { currentPageId: null, get: (id: string) => map[id], newId: () => `new-${++n}`, today: TODAY, notebookTitle: 'Meditações' }
}

describe('reading the actions of the routines', () => {
  it('accepts changes of tasks by id, typed and bounded', () => {
    expect(
      cleanAction({
        do: 'update-tasks',
        tasks: [
          { id: 'task-rep-0001', priority: 'p1', due: '2026-10-23', block: { start: '10:00', end: '11:30' }, title: ' Draft  it ' },
          { id: 'current', priority: 'P1' },
          { id: '@made', priority: 'P1' },
          { id: 'task-bill-001', due: '2026-13-01', priority: 'P9', block: { start: '11:00', end: '10:00' } },
          { id: 'task-bill-001', due: null, priority: null }
        ]
      })
    ).toEqual({
      do: 'update-tasks',
      tasks: [
        { id: 'task-rep-0001', priority: 'P1', due: '2026-10-23', block: { start: '10:00', end: '11:30' }, title: 'Draft it' },
        { id: 'task-bill-001', due: null, priority: null }
      ]
    })
    expect(cleanAction({ do: 'update-tasks', tasks: [{ id: 'task-rep-0001' }] })).toBeNull()
    const many = cleanAction({ do: 'update-tasks', tasks: Array.from({ length: 60 }, () => ({ id: 'task-rep-0001', priority: 'P2' })) })
    expect(many?.do === 'update-tasks' && many.tasks.length).toBe(TASK_ACTION_LIMITS.tasks)
  })

  it('accepts steps under a task and the close of the day', () => {
    expect(cleanAction({ do: 'add-subtasks', task: 'task-rep-0001', titles: ['One', '  ', 'Two\nlines'] })).toEqual({
      do: 'add-subtasks',
      task: 'task-rep-0001',
      titles: ['One', 'Two lines']
    })
    expect(cleanAction({ do: 'add-subtasks', task: 'current', titles: ['One'] })).toBeNull()
    expect(cleanAction({ do: 'add-subtasks', task: 'task-rep-0001', titles: [] })).toBeNull()
    expect(cleanAction({ do: 'close-day', line: 'A good day.', plans: ['a', 'b', 'c', 'd'] })).toEqual({
      do: 'close-day',
      line: 'A good day.',
      plans: ['a', 'b', 'c']
    })
    expect(cleanAction({ do: 'close-day' })).toBeNull()
    const answer = `Plan.\n\n\`\`\`sel-actions\n${JSON.stringify([{ do: 'update-tasks', tasks: [{ id: 'task-rep-0001', priority: 'P1' }] }])}\n\`\`\``
    expect(splitActions(answer)).toMatchObject({ text: 'Plan.', rejected: 0, actions: [{ do: 'update-tasks' }] })
  })
})

describe('applying a plan of the day (C2)', () => {
  it('changes only what was shown: priorities, dates and blocks of existing tasks', () => {
    const map = workspace()
    const plan = planActions(
      [
        {
          do: 'update-tasks',
          tasks: [
            { id: 'task-rep-0001', priority: 'P1', block: { start: '09:30', end: '11:00' } },
            { id: 'task-bill-001', due: '2026-10-24' },
            { id: 'task-blk-0001', due: '2026-10-23' },
            { id: 'page-other-01', priority: 'P1' },
            { id: 'task-gone-001', priority: 'P1' }
          ]
        }
      ],
      env(map)
    )
    expect(plan.done).toEqual(['Changed 3 tasks.'])
    expect(plan.skipped).toEqual(['2 tasks were not found.'])
    const after = applyOpsToMap(map, plan.ops).map
    // A late task's block goes on the day being planned (today), the priority by its option id; the rest stays.
    expect(after['task-rep-0001'].props.values).toEqual({
      [TASK_PROPS.due]: { start: '2026-10-22T09:30', end: '2026-10-22T11:00' },
      [TASK_PROPS.project]: 'p-web',
      [TASK_PROPS.priority]: 'tasks.p1'
    })
    // A date with a time keeps the time; a block moves whole.
    expect(after['task-bill-001'].props.values?.[TASK_PROPS.due]).toBe('2026-10-24T09:00')
    expect(after['task-blk-0001'].props.values).toEqual({
      [TASK_PROPS.due]: { start: '2026-10-23T14:00', end: '2026-10-23T15:00' },
      [TASK_PROPS.priority]: 'tasks.p3'
    })
    expect(after['page-other-01']).toEqual(map['page-other-01'])
    // Undo puts every task back as it was.
    const undo = invertOps(plan.ops, (id) => map[id])
    const back = applyOpsToMap(after, undo.inverse).map
    for (const id of ['task-rep-0001', 'task-bill-001', 'task-blk-0001']) expect(back[id].props).toEqual(map[id].props)
  })

  it('blocks today a task without a date, and takes dates and priorities off', () => {
    const map = workspace()
    map['task-nodate01'] = block('task-nodate01', 'page', { title: [['Someday']], values: {} }, { parentId: TASKS_DATABASE_ID })
    const plan = planActions(
      [
        {
          do: 'update-tasks',
          tasks: [
            { id: 'task-nodate01', block: { start: '16:00', end: '16:30' } },
            { id: 'task-blk-0001', due: null, priority: null }
          ]
        }
      ],
      env(map)
    )
    const after = applyOpsToMap(map, plan.ops).map
    expect(after['task-nodate01'].props.values?.[TASK_PROPS.due]).toEqual({ start: '2026-10-22T16:00', end: '2026-10-22T16:30' })
    expect(after['task-blk-0001'].props.values).toEqual({})
  })

  it('says what it will do on the card', () => {
    const map = workspace()
    const one = {
      do: 'update-tasks' as const,
      tasks: [{ id: 'task-rep-0001', priority: 'P1' as const, block: { start: '09:30', end: '11:00' } }]
    }
    expect(describeAction(one, env(map))).toBe('Make P1, block 09:30–11:00 for “Write the report”')
    expect(summarizeActions([one])).toBe('1 task changed')
    expect(actionTargets([one], null)).toEqual([TASKS_DATABASE_ID, 'task-rep-0001'])
  })
})

describe('applying a way to unstick a task (C3)', () => {
  it('creates the right subtasks, in the task’s project', () => {
    const map = workspace()
    const plan = planActions([{ do: 'add-subtasks', task: 'task-rep-0001', titles: ['Find the data', 'Write the intro'] }], env(map))
    expect(plan.done).toEqual(['Added 2 steps under “Write the report”.'])
    const after = applyOpsToMap(map, plan.ops).map
    expect(after[TASKS_DATABASE_ID].content).toEqual(['task-rep-0001', 'task-bill-001', 'task-blk-0001', 'new-1', 'new-2'])
    expect(after['new-1']).toMatchObject({
      type: 'page',
      parentId: TASKS_DATABASE_ID,
      props: { title: [['Find the data']], values: { [TASK_PROPS.parent]: ['task-rep-0001'], [TASK_PROPS.project]: 'p-web' } }
    })
    expect(planActions([{ do: 'add-subtasks', task: 'page-other-01', titles: ['x'] }], env(map)).skipped).toEqual([
      'No steps were added: the task was not found.'
    ])
  })

  it('rewrites a title as the next action', () => {
    const map = workspace()
    const plan = planActions([{ do: 'update-tasks', tasks: [{ id: 'task-rep-0001', title: 'Open the template' }] }], env(map))
    expect(applyOpsToMap(map, plan.ops).map['task-rep-0001'].props.title).toEqual([['Open the template']])
  })
})

describe('applying the close of the day (C4)', () => {
  it('starts Meditations if needed, writes today’s line and tomorrow’s plans, and undoes it all', () => {
    const map = workspace()
    const plan = planActions([{ do: 'close-day', line: 'A steady day.', plans: ['Call the bank'] }], env(map))
    expect(plan.done).toEqual(['Wrote today’s line in Meditations.', 'Set 1 plan for tomorrow.'])
    const after = applyOpsToMap(map, plan.ops).map
    expect(after[NOTEBOOK_ID].props).toMatchObject({ system: 'notebook', title: [['Meditações']] })
    expect(after[entryId(TODAY)]).toMatchObject({ type: 'text', parentId: NOTEBOOK_ID, props: { title: [['A steady day.']] } })
    expect(after[entryId('2026-10-23')].props).toEqual({ plans: ['Call the bank'] })
    const undo = invertOps(plan.ops, (id) => map[id])
    const back = applyOpsToMap(after, undo.inverse).map
    expect(back[entryId(TODAY)]).toBeUndefined()
    expect(back[entryId('2026-10-23')]).toBeUndefined()
  })

  it('adds after what the user already wrote, and keeps the plans already set', () => {
    const map = workspace()
    map[NOTEBOOK_ID] = block(
      NOTEBOOK_ID,
      'page',
      { system: 'notebook', title: [['Meditations']] },
      {
        content: [entryId(TODAY), entryId('2026-10-23')]
      }
    )
    map[entryId(TODAY)] = block(entryId(TODAY), 'text', { title: [['Rain all day.']] }, { parentId: NOTEBOOK_ID })
    map[entryId('2026-10-23')] = block(entryId('2026-10-23'), 'text', { plans: ['Gym', 'Read'] } as BlockProps, { parentId: NOTEBOOK_ID })
    const plan = planActions([{ do: 'close-day', line: 'Got the report out.', plans: ['Call the bank', 'Too many'] }], env(map))
    const after = applyOpsToMap(map, plan.ops).map
    expect(plan.ops.every((op) => op.op === 'update')).toBe(true)
    expect(after[entryId(TODAY)].props.title).toEqual([['Rain all day.\nGot the report out.']])
    expect((after[entryId('2026-10-23')].props as { plans?: string[] }).plans).toEqual(['Gym', 'Read', 'Call the bank'])
    expect(actionTargets([{ do: 'close-day', line: 'x' }], null)).toContain(NOTEBOOK_ID)
  })
})
