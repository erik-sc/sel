// Relations as the repository and the Markdown export see them: duplicating rows and
// databases keeps the links meaningful, and an export shows linked titles and rollups.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Block, PropertySchema, PropertyValue } from '../../shared/types'
import { pageToMarkdown } from '../markdown'
import type { Repository } from './repository'
import { openTestRepository } from './testing'

let repo: Repository

beforeEach(() => {
  repo = openTestRepository()
})

const TITLE: PropertySchema = { id: 'title', name: 'Name', type: 'title' }

function tableOf(schema: Record<string, PropertySchema>): { schema: Record<string, PropertySchema>; views: NonNullable<Block['props']['views']> } {
  return { schema, views: [{ id: 'v', name: 'Table', type: 'table', visibleProperties: Object.keys(schema), filters: [], sorts: [] }] }
}

function database(title: string, schema: Record<string, PropertySchema>, parentId: string | null = null): Block {
  return repo.create({ type: 'database', parentId, props: { title: [[title]], ...tableOf(schema) } })
}

function row(databaseId: string, title: string, values: Record<string, PropertyValue> = {}): Block {
  return repo.create({ type: 'page', parentId: databaseId, props: { title: [[title]], values } })
}

const values = (id: string): Record<string, PropertyValue> => repo.get(id)?.props.values ?? {}

/** Tasks.project <-> Projects.tasks, two-way, inside a page "Work". */
function twoWay(): { work: Block; tasks: Block; projects: Block; p1: Block; t1: Block } {
  const work = repo.create({ type: 'page', parentId: null, props: { title: [['Work']] } })
  const tasks = database('Tasks', { title: TITLE }, work.id)
  const projects = database('Projects', { title: TITLE }, work.id)
  repo.update(tasks.id, {
    props: tableOf({
      title: TITLE,
      project: { id: 'project', name: 'Project', type: 'relation', relation: { databaseId: projects.id, syncedPropertyId: 'tasks' } },
      hours: { id: 'hours', name: 'Hours', type: 'number' }
    })
  })
  repo.update(projects.id, {
    props: tableOf({
      title: TITLE,
      tasks: { id: 'tasks', name: 'Tasks', type: 'relation', relation: { databaseId: tasks.id, syncedPropertyId: 'project' } },
      total: { id: 'total', name: 'Total hours', type: 'rollup', rollup: { relationId: 'tasks', propertyId: 'hours', function: 'sum' } }
    })
  })
  const p1 = row(projects.id, 'Alpha')
  const t1 = row(tasks.id, 'Write', { project: [p1.id], hours: 2 })
  const t2 = row(tasks.id, 'Test', { project: [p1.id], hours: 3 })
  repo.update(p1.id, { props: { values: { tasks: [t1.id, t2.id] } } })
  return { work, tasks: repo.get(tasks.id)!, projects: repo.get(projects.id)!, p1: repo.get(p1.id)!, t1: repo.get(t1.id)! }
}

describe('duplicating related rows and databases', () => {
  it('a duplicated row shows on the other side of its two-way relation', () => {
    const { p1, t1 } = twoWay()
    const copy = repo.duplicate(t1.id)
    expect(values(copy.id).project).toEqual([p1.id])
    const links = values(p1.id).tasks as string[]
    expect(links).toHaveLength(3)
    expect(links[0]).toBe(t1.id)
    expect(links[2]).toBe(copy.id)
    // The other side changed: it is reported like any other write.
    expect(repo.drainChanges()).toContain(p1.id)
  })

  it('a duplicated page holding both databases relates the copies to each other', () => {
    const { work, tasks, projects, p1 } = twoWay()
    const copy = repo.duplicate(work.id)
    const [tasksCopy, projectsCopy] = repo.children(copy.id)
    expect(tasksCopy.id).not.toBe(tasks.id)
    expect(tasksCopy.props.schema?.project.relation).toEqual({ databaseId: projectsCopy.id, syncedPropertyId: 'tasks' })
    expect(projectsCopy.props.schema?.tasks.relation).toEqual({ databaseId: tasksCopy.id, syncedPropertyId: 'project' })
    const [p1Copy] = repo.children(projectsCopy.id)
    const taskCopies = repo.children(tasksCopy.id)
    expect(p1Copy.props.values?.tasks).toEqual(taskCopies.map((b) => b.id))
    for (const task of taskCopies) expect(task.props.values?.project).toEqual([p1Copy.id])
    // The originals are untouched.
    expect(values(p1.id).tasks).toHaveLength(2)
    expect(repo.get(projects.id)?.props.schema?.tasks.relation).toEqual({ databaseId: tasks.id, syncedPropertyId: 'project' })
  })

  it('a duplicated database keeps its links to a database outside the copy, one-way', () => {
    const { tasks, projects, p1 } = twoWay()
    const copy = repo.duplicate(tasks.id)
    expect(copy.props.schema?.project.relation).toEqual({ databaseId: projects.id })
    for (const task of repo.children(copy.id)) expect(task.props.values?.project).toEqual([p1.id])
    expect(values(p1.id).tasks).toHaveLength(2)
  })
})

describe('Markdown export', () => {
  it('shows the titles of linked rows and the result of a rollup', () => {
    const { projects, tasks } = twoWay()
    const projectsMd = pageToMarkdown(repo, projects.id).markdown
    expect(projectsMd).toContain('| Name | Tasks | Total hours |')
    expect(projectsMd).toContain('| Alpha | Write, Test | 5 |')
    const tasksMd = pageToMarkdown(repo, tasks.id).markdown
    expect(tasksMd).toContain('| Write | Alpha | 2 |')
  })

  it('leaves out links to rows in the trash', () => {
    const { projects, t1 } = twoWay()
    repo.delete(t1.id)
    expect(pageToMarkdown(repo, projects.id).markdown).toContain('| Alpha | Test | 3 |')
  })
})
