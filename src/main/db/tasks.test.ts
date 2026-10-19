import { beforeEach, describe, expect, it } from 'vitest'
import { TASK_CORE_TYPES, TASK_PROPS, TASKS_DATABASE_ID, taskSchemaProblem, tasksDatabaseProps } from '../../shared/tasks'
import type { PropertySchema } from '../../shared/types'
import { detectSignal, selectTasks } from '../briefing/tasks'
import type { Repository } from './repository'
import { seedIfEmpty } from './seed'
import { ensureTasksDatabase } from './tasks'
import { openTestRepository } from './testing'

let repo: Repository

beforeEach(() => {
  repo = openTestRepository()
})

const schemaOf = (): Record<string, PropertySchema> => repo.get(TASKS_DATABASE_ID)!.props.schema!

describe('seeding the Tasks database', () => {
  it('creates the built-in database at the root, with its fixed id and properties', () => {
    expect(ensureTasksDatabase(repo)).toBe(TASKS_DATABASE_ID)
    const db = repo.get(TASKS_DATABASE_ID)!
    expect(db.type).toBe('database')
    expect(db.parentId).toBeNull()
    expect(db.props.system).toBe('tasks')
    for (const [id, type] of Object.entries(TASK_CORE_TYPES)) expect(schemaOf()[id]?.type).toBe(type)
    expect(schemaOf()[TASK_PROPS.priority].options?.map((option) => option.name)).toEqual(['P1', 'P2', 'P3', 'P4'])
    // The hidden properties stay out of the views.
    for (const view of db.props.views!) {
      expect(view.visibleProperties).not.toContain(TASK_PROPS.recurrence)
      expect(view.visibleProperties).not.toContain(TASK_PROPS.completedAt)
    }
  })

  it('is idempotent', () => {
    ensureTasksDatabase(repo)
    const first = repo.get(TASKS_DATABASE_ID)!
    repo.drainChanges()
    ensureTasksDatabase(repo)
    ensureTasksDatabase(repo)
    expect(repo.get(TASKS_DATABASE_ID)).toEqual(first)
    expect(repo.drainChanges()).toEqual([])
    expect(repo.listDatabases().filter((db) => db.props.system === 'tasks')).toHaveLength(1)
  })

  it('writes the same block on every device, so a sync has nothing to merge', () => {
    // Nothing random or clock-dependent goes into what the seed stores.
    expect(tasksDatabaseProps()).toEqual(tasksDatabaseProps())
    const other = openTestRepository()
    ensureTasksDatabase(repo)
    ensureTasksDatabase(other)
    expect(other.get(TASKS_DATABASE_ID)!.props).toEqual(repo.get(TASKS_DATABASE_ID)!.props)
    other.close()
  })

  it('leaves the welcome content alone, before or after it', () => {
    expect(seedIfEmpty(repo)).not.toBeNull()
    const roots = repo.listRoot().length
    ensureTasksDatabase(repo)
    expect(repo.listRoot()).toHaveLength(roots + 1)
    // The user's own databases and rows keep their ids.
    expect(repo.listDatabases().filter((db) => db.props.system !== 'tasks')).toHaveLength(1)
  })

  it('keeps what the user added and renamed', () => {
    ensureTasksDatabase(repo)
    const schema: Record<string, PropertySchema> = { ...schemaOf(), mine: { id: 'mine', name: 'Energy', type: 'number' } }
    schema[TASK_PROPS.done] = { ...schema[TASK_PROPS.done], name: 'Feito' }
    repo.update(TASKS_DATABASE_ID, { props: { schema } })
    ensureTasksDatabase(repo)
    expect(schemaOf().mine?.name).toBe('Energy')
    expect(schemaOf()[TASK_PROPS.done].name).toBe('Feito')
  })
})

describe('protecting the Tasks database', () => {
  beforeEach(() => {
    ensureTasksDatabase(repo)
  })

  it('refuses to delete a core property', () => {
    const schema = { ...schemaOf() }
    delete (schema as Record<string, unknown>)[TASK_PROPS.due]
    expect(() => repo.update(TASKS_DATABASE_ID, { props: { schema } })).toThrow(/cannot be deleted/)
    expect(() => repo.apply([{ op: 'update', id: TASKS_DATABASE_ID, patch: { props: { schema } } }])).toThrow(/cannot be deleted/)
    expect(() => repo.update(TASKS_DATABASE_ID, { props: { schema: null } })).toThrow()
    expect(schemaOf()[TASK_PROPS.due]).toBeDefined()
  })

  it('refuses to change the type of a core property', () => {
    const schema = { ...schemaOf(), [TASK_PROPS.priority]: { id: TASK_PROPS.priority, name: 'Priority', type: 'text' as const } }
    expect(() => repo.update(TASKS_DATABASE_ID, { props: { schema } })).toThrow(/change its type/)
    expect(schemaOf()[TASK_PROPS.priority].type).toBe('select')
  })

  it('lets the user add, rename and remove properties of their own, and options', () => {
    const schema: Record<string, PropertySchema> = { ...schemaOf(), mine: { id: 'mine', name: 'Energy', type: 'number' } }
    schema[TASK_PROPS.project] = { ...schema[TASK_PROPS.project], name: 'Projeto', options: [{ id: 'p', name: 'Home', color: 'green' }] }
    repo.update(TASKS_DATABASE_ID, { props: { schema } })
    expect(schemaOf()[TASK_PROPS.project].options).toHaveLength(1)
    const without = { ...schemaOf() }
    delete (without as Record<string, unknown>).mine
    repo.update(TASKS_DATABASE_ID, { props: { schema: without } })
    expect(schemaOf().mine).toBeUndefined()
    // Other edits do not touch the schema at all.
    repo.update(TASKS_DATABASE_ID, { props: { title: [['Tarefas']] } })
    expect(taskSchemaProblem(schemaOf())).toBeNull()
  })

  it('cannot be trashed or deleted', () => {
    expect(() => repo.delete(TASKS_DATABASE_ID)).toThrow(/cannot be deleted/)
    expect(repo.get(TASKS_DATABASE_ID)?.trashedAt).toBeNull()
  })

  it('puts back a core property that went missing outside the repository', () => {
    // As a damaged sync could leave it: written straight into the table.
    const schema = { ...schemaOf() }
    delete (schema as Record<string, unknown>)[TASK_PROPS.labels]
    const props = { ...repo.get(TASKS_DATABASE_ID)!.props, schema }
    ;(repo as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): void } } }).db
      .prepare('UPDATE blocks SET props = ? WHERE id = ?')
      .run(JSON.stringify(props), TASKS_DATABASE_ID)
    expect(taskSchemaProblem(schemaOf())).not.toBeNull()
    ensureTasksDatabase(repo)
    expect(schemaOf()[TASK_PROPS.labels]?.type).toBe('multi_select')
  })
})

describe('the Today screen reads it', () => {
  it('as a task list, by property id even once renamed', () => {
    ensureTasksDatabase(repo)
    const signal = detectSignal(repo.get(TASKS_DATABASE_ID)!.props)
    expect(signal).toMatchObject({ checkbox: TASK_PROPS.done, date: TASK_PROPS.due, priority: { property: TASK_PROPS.priority } })
    expect(signal?.priority?.options.get('tasks.p1')?.rank).toBe(0)

    const schema = { ...schemaOf() }
    schema[TASK_PROPS.done] = { ...schema[TASK_PROPS.done], name: 'Checked off' }
    schema[TASK_PROPS.due] = { ...schema[TASK_PROPS.due], name: 'Whenever' }
    schema[TASK_PROPS.priority] = { ...schema[TASK_PROPS.priority], name: 'Weight' }
    // Placed first and named like a due date: still not the one.
    const renamed = { deadline: { id: 'deadline', name: 'Deadline', type: 'date' as const }, ...schema }
    repo.update(TASKS_DATABASE_ID, { props: { schema: renamed } })
    expect(detectSignal(repo.get(TASKS_DATABASE_ID)!.props)).toMatchObject({
      checkbox: TASK_PROPS.done,
      date: TASK_PROPS.due,
      priority: { property: TASK_PROPS.priority }
    })
  })

  it('with overdue and today rows, and without the done ones', () => {
    ensureTasksDatabase(repo)
    const add = (title: string, values: Record<string, unknown>): void => {
      repo.create({ type: 'page', parentId: TASKS_DATABASE_ID, props: { title: [[title]], values: values as never } })
    }
    add('Late', { [TASK_PROPS.due]: { start: '2026-10-10' }, [TASK_PROPS.priority]: 'tasks.p1' })
    add('Now', { [TASK_PROPS.due]: { start: '2026-10-15T14:30' } })
    add('Done', { [TASK_PROPS.due]: { start: '2026-10-15' }, [TASK_PROPS.done]: true })
    const selection = selectTasks([repo.get(TASKS_DATABASE_ID)!, ...repo.children(TASKS_DATABASE_ID)], { today: '2026-10-15' })
    expect(selection.overdue.map((task) => task.title)).toEqual(['Late'])
    expect(selection.overdue[0].priority?.name).toBe('P1')
    expect(selection.today.map((task) => task.title)).toEqual(['Now'])
  })
})
