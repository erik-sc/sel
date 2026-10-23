import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { TASK_PROPS, TASKS_DATABASE_ID, tasksDatabaseProps } from './index'
import {
  cleanObjective,
  lateMilestones,
  projectOverview,
  projectSummaries,
  projectsWithoutNext,
  readPlan,
  readPlans,
  readProjectTasks,
  withPlan
} from './projects'

const HOME = { id: 'home', name: 'Home', color: 'green' }
const WORK = { id: 'work', name: 'Work', color: 'blue' }

function row(id: string, title: string, values: Record<string, unknown>, extra: Partial<Block> = {}): Block {
  return {
    id,
    type: 'page',
    parentId: TASKS_DATABASE_ID,
    content: [],
    props: { title: [[title]], values: values as Block['props']['values'] },
    createdAt: 1,
    updatedAt: 1,
    trashedAt: null,
    ...extra
  } as Block
}

describe('a project plan as stored', () => {
  it('reads what is there and drops what is not right', () => {
    const plan = readPlan({
      objective: '  Move   house\nby spring ',
      next: 'task-1',
      milestones: [
        { id: 'b', title: 'Boxes', date: '2026-12-01' },
        { id: 'a', title: 'Contract', date: '2026-11-01', done: true },
        { id: 'c', title: 'Someday' },
        { id: 'a', title: 'Duplicate', date: '2026-01-01' },
        { id: 'd', title: '', date: '2026-01-01' },
        { title: 'No id' },
        { id: 'e', title: 'Bad date', date: 'soon' }
      ]
    })
    expect(plan.objective).toBe('Move house by spring')
    expect(plan.next).toBe('task-1')
    expect(plan.milestones.map((milestone) => milestone.id)).toEqual(['a', 'b', 'c', 'e'])
    expect(plan.milestones[0]).toEqual({ id: 'a', title: 'Contract', date: '2026-11-01', done: true })
    expect(plan.milestones[3].date).toBeNull()
  })

  it('is empty for anything else', () => {
    expect(readPlan('nonsense')).toEqual({ objective: '', next: null, milestones: [] })
    expect(readPlans([1, 2])).toEqual({})
  })

  it('keeps the objective to one sentence’s length', () => {
    expect(cleanObjective('x'.repeat(500))).toHaveLength(200)
    expect(cleanObjective(42)).toBe('')
  })

  it('changes one project, drops an empty plan and the plans of projects that are gone', () => {
    const stored = { home: { objective: 'A calm home' }, gone: { objective: 'Old' } }
    const next = withPlan(stored, 'work', (plan) => ({ ...plan, objective: 'Ship 1.0' }), ['home', 'work'])
    expect(Object.keys(next).sort()).toEqual(['home', 'work'])
    expect(next.work.objective).toBe('Ship 1.0')
    const cleared = withPlan(next, 'home', (plan) => ({ ...plan, objective: '' }))
    expect(cleared.home).toBeUndefined()
  })
})

describe('projects with a direction', () => {
  const rows = [
    row('t1', 'Pack books', { [TASK_PROPS.project]: 'home', [TASK_PROPS.done]: true }),
    row('t2', 'Call movers', { [TASK_PROPS.project]: 'home' }),
    row('t3', 'Label boxes', { [TASK_PROPS.project]: 'home', [TASK_PROPS.parent]: ['t2'] }),
    row('t4', 'Write spec', { [TASK_PROPS.project]: 'work' }),
    row('t5', 'Old', { [TASK_PROPS.project]: 'work' }, { trashedAt: 9 }),
    row('t6', 'Loose', {})
  ]

  it('counts tasks done of all, without a percentage', () => {
    const tasks = readProjectTasks(rows)
    expect(tasks.map((task) => task.id)).toEqual(['t1', 't2', 't3', 't4', 't6'])
    const [home, work] = projectSummaries([HOME, WORK], {}, tasks)
    expect(home).toMatchObject({ done: 1, total: 3 })
    expect(work).toMatchObject({ done: 0, total: 1 })
  })

  it('shows the next action chosen while it is open, and flags the projects without one', () => {
    const tasks = readProjectTasks(rows)
    const plans = readPlans({ home: { next: 't2' }, work: { next: 't1' } })
    const [home, work] = projectSummaries([HOME, WORK], plans, tasks)
    expect(home.next).toEqual({ id: 't2', title: 'Call movers' })
    expect(home.needsNext).toBe(false)
    // t1 is done, and not Work's anyway: no next action, and the first open task is offered.
    expect(work.next).toBeNull()
    expect(work.needsNext).toBe(true)
    expect(work.suggestion).toEqual({ id: 't4', title: 'Write spec' })
    expect(projectsWithoutNext([home, work]).map((summary) => summary.id)).toEqual(['work'])
  })

  it('offers a top-level task before a subtask', () => {
    const tasks = readProjectTasks([
      row('s', 'Sub', { [TASK_PROPS.project]: 'home', [TASK_PROPS.parent]: ['p'] }),
      row('p', 'Top', { [TASK_PROPS.project]: 'home' })
    ])
    expect(projectSummaries([HOME], {}, tasks)[0].suggestion?.id).toBe('p')
  })

  it('is read from the Tasks database block itself', () => {
    const database = {
      id: TASKS_DATABASE_ID,
      type: 'database',
      parentId: null,
      content: rows.map((each) => each.id),
      props: { ...tasksDatabaseProps(), projects: { home: { objective: 'A calm home', next: 't2' } } },
      createdAt: 1,
      updatedAt: 1,
      trashedAt: null
    } as Block
    const schema = database.props.schema ?? {}
    schema[TASK_PROPS.project] = { ...schema[TASK_PROPS.project], options: [HOME, WORK] }
    const summaries = projectOverview(database, rows)
    expect(summaries.map((summary) => [summary.id, summary.objective, summary.needsNext])).toEqual([
      ['home', 'A calm home', false],
      ['work', '', true]
    ])
    expect(projectOverview(undefined, rows)).toEqual([])
  })

  it('knows which milestones are past their date', () => {
    const plan = readPlan({
      milestones: [
        { id: 'a', title: 'Late', date: '2026-10-01' },
        { id: 'b', title: 'Reached', date: '2026-10-01', done: true },
        { id: 'c', title: 'Ahead', date: '2026-11-01' },
        { id: 'd', title: 'Undated' }
      ]
    })
    expect(lateMilestones(plan, '2026-10-22').map((milestone) => milestone.id)).toEqual(['a'])
  })
})
