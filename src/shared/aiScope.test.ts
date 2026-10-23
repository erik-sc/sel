// A project's or database's own context (0.8.0 A4): how it is stored and cleaned, which one a
// request about a page carries (the project of X and not of Y), and that nothing private does.
import { describe, expect, it } from 'vitest'
import {
  contextScopes,
  databaseContextOf,
  projectContextOf,
  readScopeContext,
  SCOPE_CONTEXT_CAPS,
  scopesWithContext,
  storedScopeContext
} from './aiScope'
import { TASK_PROPS, TASKS_DATABASE_ID } from './tasks'
import { isEmptyPlan, readPlan, withPlan } from './tasks/projects'
import type { Block, BlockProps } from './types'

function block(id: string, type: Block['type'], parentId: string | null, props: BlockProps = {}, extra: Partial<Block> = {}): Block {
  return { id, type, parentId, content: [], props, createdAt: 0, updatedAt: 0, trashedAt: null, ...extra }
}

const schema = {
  title: { id: 'title', name: 'Name', type: 'title' as const },
  [TASK_PROPS.project]: {
    id: TASK_PROPS.project,
    name: 'Project',
    type: 'select' as const,
    options: [
      { id: 'p-x', name: 'Auxiliadora', color: 'blue' },
      { id: 'p-y', name: 'Garden', color: 'green' },
      { id: 'p-z', name: 'Health', color: 'red' }
    ]
  }
}

function workspace(extra: { tasks?: BlockProps; notes?: BlockProps } = {}): Map<string, Block> {
  const blocks = [
    block(TASKS_DATABASE_ID, 'database', null, {
      title: [['Tasks']],
      schema,
      projects: {
        'p-x': { objective: 'Ship it', context: { text: 'X is for the bank.', pages: ['brief-x'] } },
        'p-y': { context: { text: 'Y is the garden.', pages: [] } },
        'p-z': { context: { text: 'Z is health.', pages: [] } }
      },
      aiPrivateProjects: ['p-z'],
      aiContext: { text: 'Tasks are short.', pages: [] },
      ...extra.tasks
    }),
    block('task-x', 'page', TASKS_DATABASE_ID, { title: [['Call the bank']], values: { [TASK_PROPS.project]: 'p-x' } }),
    block('task-y', 'page', TASKS_DATABASE_ID, { title: [['Water']], values: { [TASK_PROPS.project]: 'p-y' } }),
    block('task-z', 'page', TASKS_DATABASE_ID, { title: [['Doctor']], values: { [TASK_PROPS.project]: 'p-z' } }),
    block('task-none', 'page', TASKS_DATABASE_ID, { title: [['Loose']] }),
    block('inside-x', 'page', 'task-x', { title: [['Meeting notes']] }),
    block('notes', 'database', null, {
      title: [['Reading notes']],
      aiContext: { text: 'Books I read.', pages: ['brief-x'] },
      ...extra.notes
    }),
    block('note-1', 'page', 'notes', { title: [['Dune']] }),
    block('view', 'database', 'home', { sourceId: 'notes' }),
    block('home', 'page', null, { title: [['Home']] }),
    block('brief-x', 'page', null, { title: [['Brief']] })
  ]
  return new Map(blocks.map((each) => [each.id, each]))
}

const lookup = (blocks: Map<string, Block>) => ({ get: (id: string) => blocks.get(id) ?? null })

describe('the context of a project or database, as stored', () => {
  it('is cleaned and capped, and an empty one is nothing', () => {
    expect(readScopeContext(null)).toBeNull()
    expect(readScopeContext({ text: '   ', pages: [] })).toBeNull()
    expect(readScopeContext({ text: 'x'.repeat(SCOPE_CONTEXT_CAPS.text + 50), pages: ['a', 'b', 'c', 'd', 'a', '../bad'] })).toEqual({
      text: 'x'.repeat(SCOPE_CONTEXT_CAPS.text),
      pages: ['a', 'b', 'c']
    })
    expect(readScopeContext({ pages: ['only'] })).toEqual({ text: '', pages: ['only'] })
    expect(storedScopeContext({ text: '', pages: [] })).toBeNull()
  })

  it('is read from the database and from the project’s plan', () => {
    const blocks = workspace()
    expect(databaseContextOf(blocks.get('notes'))).toEqual({ text: 'Books I read.', pages: ['brief-x'] })
    expect(projectContextOf(blocks.get(TASKS_DATABASE_ID), 'p-x')).toEqual({ text: 'X is for the bank.', pages: ['brief-x'] })
    expect(projectContextOf(blocks.get(TASKS_DATABASE_ID), 'nope')).toBeNull()
    expect(projectContextOf(blocks.get(TASKS_DATABASE_ID), '__proto__')).toBeNull()
  })

  it('stays when the project’s plan changes, and alone keeps a plan stored', () => {
    const stored = workspace().get(TASKS_DATABASE_ID)?.props.projects
    const next = withPlan(stored, 'p-x', (plan) => ({ ...plan, objective: 'Ship it now' }))
    expect(readPlan(next['p-x']).context).toEqual({ text: 'X is for the bank.', pages: ['brief-x'] })
    // A plan with only a context is not empty; without it, it is.
    expect(isEmptyPlan(readPlan(next['p-y']))).toBe(false)
    const cleared = withPlan(next, 'p-y', (plan) => ({ ...plan, context: undefined }))
    expect(cleared['p-y']).toBeUndefined()
    // A plan without a context reads as before.
    expect(readPlan({ objective: 'a' })).toEqual({ objective: 'a', next: null, milestones: [] })
  })
})

describe('which context a request carries', () => {
  it('takes the project of a task, X and not Y, and the database it is in', () => {
    const blocks = workspace()
    const scopes = contextScopes(lookup(blocks), 'task-x')
    expect(scopes.map((scope) => [scope.kind, scope.id, scope.name])).toEqual([
      ['project', 'p-x', 'Auxiliadora'],
      ['database', TASKS_DATABASE_ID, 'Tasks']
    ])
    expect(contextScopes(lookup(blocks), 'task-y').map((scope) => scope.id)).toEqual(['p-y', TASKS_DATABASE_ID])
    expect(JSON.stringify(contextScopes(lookup(blocks), 'task-y'))).not.toContain('bank')
  })

  it('takes them for a page inside a task, and only the database for a task without a project', () => {
    const blocks = workspace()
    expect(contextScopes(lookup(blocks), 'inside-x').map((scope) => scope.id)).toEqual(['p-x', TASKS_DATABASE_ID])
    expect(contextScopes(lookup(blocks), 'task-none').map((scope) => scope.id)).toEqual([TASKS_DATABASE_ID])
  })

  it('takes a database for its rows, for itself, and for a linked view of it', () => {
    const blocks = workspace()
    expect(contextScopes(lookup(blocks), 'note-1').map((scope) => scope.id)).toEqual(['notes'])
    expect(contextScopes(lookup(blocks), 'notes').map((scope) => scope.id)).toEqual(['notes'])
    expect(contextScopes(lookup(blocks), 'view').map((scope) => scope.id)).toEqual(['notes'])
    expect(contextScopes(lookup(blocks), 'home')).toEqual([])
    expect(contextScopes(lookup(blocks), null)).toEqual([])
  })

  it('never takes a private project, a private database, or anything for a private page', () => {
    const blocks = workspace()
    // Health is private: a task of it is private itself, and gives nothing.
    expect(contextScopes(lookup(blocks), 'task-z')).toEqual([])
    const privateNotes = workspace({ notes: { aiPrivate: true } })
    expect(contextScopes(lookup(privateNotes), 'note-1')).toEqual([])
    expect(contextScopes(lookup(privateNotes), 'view')).toEqual([])
    // A project of a private Tasks database: nothing of it either.
    const privateTasks = workspace({ tasks: { aiPrivate: true } })
    expect(contextScopes(lookup(privateTasks), 'task-x')).toEqual([])
    // A page that is private by itself, under a project that is not.
    blocks.set('secret', block('secret', 'page', 'task-x', { title: [['Secret']], aiPrivate: true }))
    expect(contextScopes(lookup(blocks), 'secret')).toEqual([])
  })

  it('leaves out a project that is gone from the options', () => {
    const blocks = workspace()
    blocks.set('task-gone', block('task-gone', 'page', TASKS_DATABASE_ID, { values: { [TASK_PROPS.project]: 'p-gone' } }))
    expect(contextScopes(lookup(blocks), 'task-gone').map((scope) => scope.kind)).toEqual(['database'])
  })

  it('lists every project and database with a context, for the settings', () => {
    const blocks = workspace()
    const all = scopesWithContext(blocks.get(TASKS_DATABASE_ID), [blocks.get('notes') as Block, blocks.get(TASKS_DATABASE_ID) as Block])
    expect(all.map((scope) => `${scope.kind}:${scope.id}`)).toEqual([
      'project:p-x',
      'project:p-y',
      'project:p-z',
      'database:notes',
      `database:${TASKS_DATABASE_ID}`
    ])
  })
})
