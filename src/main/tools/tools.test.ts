import { beforeEach, describe, expect, it } from 'vitest'
import { AI_PRIVATE_MESSAGE } from '../../shared/aiPrivate'
import { REMOTE_SCOPES } from '../../shared/mcp'
import { TASKS_DATABASE_ID } from '../../shared/tasks'
import { ToolError } from '../ai/tools'
import { TOOL_NAMES } from '../ai/toolspecs'
import type { Repository } from '../db/repository'
import { ensureTasksDatabase } from '../db/tasks'
import { openTestRepository } from '../db/testing'
import * as markdown from '../markdown'
import { EVERY_TOOL, EXTERNAL_TOOL_SPECS, PACK_OF, PACKS, toolsFor } from './catalog'
import { createToolRunner } from './run'

describe('the catalog of blocks', () => {
  it('names every tool once, with a closed schema and a scope the consent screen lists', () => {
    const names = EXTERNAL_TOOL_SPECS.map((spec) => spec.name)
    expect(new Set(names).size).toBe(names.length)
    for (const { spec, scope } of EVERY_TOOL) {
      expect(spec.name).toMatch(/^[a-z][a-z_]{2,40}$/)
      expect(spec.description.length).toBeGreaterThan(20)
      expect(spec.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
      expect(REMOTE_SCOPES).toContain(scope)
    }
    expect(PACKS.map((pack) => pack.id)).toEqual(['tasks', 'workspace', 'finance'])
    for (const name of names) expect(PACK_OF.has(name)).toBe(true)
  })

  it('offers by scope: reading never brings a tool that writes', () => {
    const names = (scopes: Parameters<typeof toolsFor>[0]): string[] => toolsFor(scopes).map((tool) => tool.name)
    // What Herman reads with, the task lists and the trash; nothing else.
    expect(names(['read']).sort()).toEqual([...TOOL_NAMES, 'list_tasks', 'list_projects', 'list_trash'].sort())
    expect(names(['write'])).toEqual([
      'create_page',
      'append_to_page',
      'add_database_row',
      'update_database_row',
      'update_page',
      'move_page',
      'delete_page',
      'restore_page',
      'create_database',
      'add_database_property',
      'add_select_options'
    ])
    expect(names(['finance']).every((name) => name.startsWith('finance_'))).toBe(true)
    expect(names([])).toEqual([])
    expect(names([...REMOTE_SCOPES])).toHaveLength(EXTERNAL_TOOL_SPECS.length)
  })
})

describe('running the tools of every block', () => {
  let repo: Repository
  let run: (name: string, args?: unknown) => string
  const idOf = (text: string): string => /\[([0-9a-f-]{36})\]/u.exec(text)?.[1] as string

  beforeEach(() => {
    repo = openTestRepository()
    ensureTasksDatabase(repo)
    const runner = createToolRunner(repo, markdown)
    run = (name, args = {}) => runner(name, args)
  })

  it('sends each tool to its block, and refuses a name no block has', () => {
    expect(run('add_task', { text: 'Buy milk' })).toContain('Buy milk')
    expect(run('list_tasks', { list: 'all' })).toContain('Buy milk')
    expect(run('create_page', { title: 'Notes', markdown: 'Hello' })).toContain('Created Notes')
    expect(run('search', { query: 'Hello' })).toContain('Notes')
    expect(run('finance_month')).toContain('has nothing yet')
    expect(() => run('format_disk')).toThrow(new ToolError('There is no tool called format_disk.'))
    // Every tool listed has a runner that knows it.
    for (const { name } of EXTERNAL_TOOL_SPECS) {
      try {
        run(name)
      } catch (err) {
        expect((err as Error).message).not.toMatch(/no tool called|No such tool/i)
      }
    }
  })

  it('rewrites a page, keeping what it said in its history and the pages inside it', () => {
    const id = idOf(run('create_page', { title: 'Plan', markdown: 'Old first\n\nOld second' }))
    const inside = idOf(run('create_page', { title: 'Inside', parent: id }))
    const text = run('update_page', { id, title: 'The plan', icon: '🧭', markdown: '# New\n\nFresh text' })
    expect(text).toContain('Updated 🧭 The plan')
    expect(text).toContain('title, icon, text')
    expect(text).toContain('version history')
    const body = markdown.pageToMarkdown(repo, id).markdown
    expect(body).toContain('Fresh text')
    expect(body).not.toContain('Old first')
    expect(repo.get(inside)?.trashedAt).toBeNull()
    expect(repo.get(inside)?.parentId).toBe(id)
    // The state before is a version the user can go back to.
    repo.flushVersions()
    expect(repo.listVersions(id).length).toBeGreaterThan(0)
    expect(() => run('update_page', { id })).toThrow(/Say what to change/)
    expect(() => run('update_page', { id: TASKS_DATABASE_ID, markdown: 'x' })).toThrow(/is a database/)
    expect(run('update_page', { id, icon: null })).toContain('Updated The plan')
  })

  it('moves pages, and not into themselves, into a database or out of one', () => {
    const a = idOf(run('create_page', { title: 'A' }))
    const b = idOf(run('create_page', { title: 'B', parent: a }))
    const c = idOf(run('create_page', { title: 'C' }))
    expect(run('move_page', { id: c, parent: b })).toContain('Moved C')
    expect(repo.get(c)?.parentId).toBe(b)
    expect(() => run('move_page', { id: a, parent: c })).toThrow(/into itself/)
    expect(() => run('move_page', { id: a, parent: a })).toThrow(/into itself/)
    expect(() => run('move_page', { id: c, parent: TASKS_DATABASE_ID })).toThrow(/is a database/)
    expect(run('move_page', { id: c, parent: null })).toContain('the top level')
    expect(repo.get(c)?.parentId).toBeNull()
    const task = idOf(run('add_task', { text: 'A row' }))
    expect(() => run('move_page', { id: task, parent: a })).toThrow(/a row stays in its database/)
    expect(() => run('move_page', { id: TASKS_DATABASE_ID, parent: a })).toThrow(/built-in/)
  })

  it('deletes to the trash, lists it and restores from it; never for good', () => {
    const id = idOf(run('create_page', { title: 'Scratch', markdown: 'Text' }))
    expect(run('list_trash')).toBe('The trash is empty.')
    expect(run('delete_page', { id })).toContain('to the trash')
    expect(repo.get(id)?.trashedAt).not.toBeNull()
    expect(() => run('read_page', { id })).toThrow(ToolError)
    expect(run('list_trash')).toContain(`Scratch [${id}]`)
    expect(run('restore_page', { id })).toContain('Restored Scratch')
    expect(repo.get(id)?.trashedAt).toBeNull()
    expect(markdown.pageToMarkdown(repo, id).markdown).toContain('Text')
    expect(run('restore_page', { id })).toContain('is not in the trash')
    expect(() => run('restore_page', { id: 'nope' })).toThrow(/Nothing in the trash/)
    // The built-in database stays.
    expect(() => run('delete_page', { id: TASKS_DATABASE_ID })).toThrow(/built-in/)
    // A row of a database goes the same way.
    const row = idOf(run('add_task', { text: 'Gone' }))
    run('delete_page', { id: row })
    expect(run('list_tasks', { list: 'all' })).not.toContain('Gone')
  })

  it('creates a database, adds a property and options, and rows fit it', () => {
    const page = idOf(run('create_page', { title: 'Books page' }))
    const made = run('create_database', {
      title: 'Books',
      parent: page,
      title_property: 'Title',
      properties: [
        { name: 'Status', type: 'select', options: ['To read', 'Reading', 'To read'] },
        { name: 'Pages', type: 'number' },
        { name: 'Price', type: 'number', format: 'currency' }
      ]
    })
    const id = idOf(made)
    expect(made).toContain('“Title” (title), “Status” (select), “Pages” (number), “Price” (number)')
    const database = repo.get(id)
    expect(database?.parentId).toBe(page)
    expect(
      Object.values(database?.props.schema ?? {})
        .find((p) => p.name === 'Status')
        ?.options?.map((o) => o.name)
    ).toEqual(['To read', 'Reading'])
    expect(database?.props.views?.[0].visibleProperties).toHaveLength(4)
    expect(run('add_database_property', { database: id, name: 'Author', type: 'text' })).toContain('“Author” (text)')
    expect(repo.get(id)?.props.views?.[0].visibleProperties).toHaveLength(5)
    expect(() => run('add_database_property', { database: id, name: 'author', type: 'text' })).toThrow(/already a property/)
    expect(() => run('add_database_property', { database: id, name: 'Sum', type: 'formula' })).toThrow(/its type is one of/)
    expect(run('add_select_options', { database: id, property: 'status', options: ['Done', 'reading'] })).toContain('“Done”')
    expect(run('add_select_options', { database: id, property: 'Status', options: ['Done'] })).toContain('already has')
    expect(() => run('add_select_options', { database: id, property: 'Pages', options: ['x'] })).toThrow(/not a select/)
    const row = run('add_database_row', { database: id, values: { Title: 'Dune', Status: 'Done', Pages: 600, Author: 'Herbert' } })
    expect(row).toContain('Dune')
    expect(run('read_database', { id })).toMatch(/Dune .*Status: Done .*Pages: 600 .*Author: Herbert/u)
    expect(() => run('create_database', {})).toThrow(/title/)
  })

  it('leaves alone what is private from the AI', () => {
    const id = idOf(run('create_page', { title: 'Diary', markdown: 'Mine' }))
    repo.update(id, { props: { aiPrivate: true } })
    for (const [name, args] of [
      ['update_page', { id, title: 'x' }],
      ['move_page', { id, parent: null }],
      ['delete_page', { id }]
    ] as const)
      expect(() => run(name, args)).toThrow(new ToolError(AI_PRIVATE_MESSAGE))
    repo.update(id, { props: { aiPrivate: null } })
    run('delete_page', { id })
    repo.update(id, { props: { aiPrivate: true } })
    expect(run('list_trash')).toBe('The trash is empty.')
    expect(() => run('restore_page', { id })).toThrow(new ToolError(AI_PRIVATE_MESSAGE))
  })
})
