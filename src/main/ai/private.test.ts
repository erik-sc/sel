import { beforeEach, describe, expect, it } from 'vitest'
import { AI_CONTEXT_KEY, AI_CONTEXT_PAGES_KEY } from '../../shared/aiContext'
import { AI_PRIVATE_MESSAGE, AI_PRIVATE_PAGE_MESSAGE, aiPrivacy, isPrivateForAi, privacyChecker } from '../../shared/aiPrivate'
import type { AiRequest } from '../../shared/ai'
import { TASK_PROPS } from '../../shared/tasks'
import type { Block, PropertySchema } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import * as markdown from '../markdown'
import { buildWorkspace } from './context'
import { buildPrompt, type PromptContext } from './prompts'
import { loadContext, withoutPrivatePage } from './request'
import { loadStanding } from './standing'
import { callTool, repositorySource, ToolError, toolActivity, type ToolSource } from './tools'
import { callWriteTool } from './writes'

// "Private from AI" (shared/aiPrivate.ts): what the user keeps private, and everything under it,
// never reaches a prompt, a tool's answer, nor an app connected over MCP. Every secret below is a
// word that appears nowhere else, so that finding it anywhere is a leak.

let repo: Repository
let source: ToolSource
let projects: Block
let diary: Block
let dream: Block
let ledger: Block
let tasks: Block
let secretRow: Block
let publicRow: Block

const SECRETS = ['Zanzibar', 'Quixotic', 'Lumberjack', 'Marzipan', 'Obsidian', 'Halibut']

const page = (title: string, parentId: string | null, props: Block['props'] = {}): Block =>
  repo.create({ type: 'page', parentId, props: { title: [[title]], ...props } })
const text = (body: string, parentId: string): Block => repo.create({ type: 'text', parentId, props: { title: [[body]] } })

const expectNoSecret = (out: string | undefined, what: string): void => {
  for (const secret of SECRETS) expect(out ?? '', `${what} leaks ${secret}`).not.toContain(secret)
}

beforeEach(() => {
  repo = openTestRepository()
  source = repositorySource(repo, markdown)
  projects = page('Projects', null)
  text('Current work on the garden', projects.id)
  // A private page with a sub-page and a database inside.
  diary = page('Zanzibar diary', projects.id, { aiPrivate: true })
  text('The garden plan I keep to myself: Quixotic', diary.id)
  dream = page('Lumberjack dream', diary.id)
  text('A garden full of Marzipan', dream.id)
  const schema: Record<string, PropertySchema> = { title: { id: 'title', name: 'Name', type: 'title' } }
  ledger = repo.create({ type: 'database', parentId: projects.id, props: { title: [['Obsidian ledger']], schema, aiPrivate: true } })
  repo.create({ type: 'page', parentId: ledger.id, props: { title: [['Garden spend']] } })
  // A task list with a private project and a public one.
  tasks = repo.create({
    type: 'database',
    parentId: null,
    props: {
      title: [['Garden tasks']],
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        [TASK_PROPS.project]: {
          id: TASK_PROPS.project,
          name: 'Project',
          type: 'select',
          options: [
            { id: 'p-home', name: 'Home', color: 'blue' },
            { id: 'p-health', name: 'Health', color: 'red' }
          ]
        }
      },
      aiPrivateProjects: ['p-health']
    }
  })
  secretRow = repo.create({
    type: 'page',
    parentId: tasks.id,
    props: { title: [['Halibut appointment for the garden']], values: { [TASK_PROPS.project]: 'p-health' } }
  })
  publicRow = repo.create({
    type: 'page',
    parentId: tasks.id,
    props: { title: [['Water the garden']], values: { [TASK_PROPS.project]: 'p-home' } }
  })
})

describe('the rule', () => {
  it('marks a page, everything inside it, a database and its rows, and the rows of a private project', () => {
    const lookup = { get: (id: string) => repo.get(id) }
    expect(aiPrivacy(lookup, diary.id)).toEqual({ reason: 'self', fromId: diary.id })
    expect(aiPrivacy(lookup, dream.id)).toEqual({ reason: 'ancestor', fromId: diary.id })
    const deep = text('deep', dream.id)
    expect(isPrivateForAi(lookup, deep.id)).toBe(true)
    expect(isPrivateForAi(lookup, repo.children(ledger.id)[0].id)).toBe(true)
    expect(aiPrivacy(lookup, secretRow.id)).toEqual({ reason: 'project', fromId: tasks.id })
    expect(isPrivateForAi(lookup, publicRow.id)).toBe(false)
    expect(isPrivateForAi(lookup, projects.id)).toBe(false)
    expect(isPrivateForAi(lookup, tasks.id)).toBe(false)
    expect(isPrivateForAi(lookup, 'no-such-block')).toBe(false)
  })

  it('makes a linked view of a private database private too', () => {
    const view = repo.create({
      type: 'database',
      parentId: projects.id,
      props: { sourceId: ledger.id, views: repo.get(ledger.id)!.props.views }
    })
    expect(aiPrivacy({ get: (id) => repo.get(id) }, view.id)).toEqual({ reason: 'source', fromId: ledger.id })
  })

  it('is lifted by taking the mark off, for everything under it', () => {
    repo.update(diary.id, { props: { aiPrivate: null } as never })
    const check = privacyChecker({ get: (id) => repo.get(id) })
    expect(check(diary.id)).toBe(false)
    expect(check(dream.id)).toBe(false)
  })
})

describe('the prompt', () => {
  /** The whole prompt of a request, built from the same parts as the app's (ai/index.ts). */
  const promptFor = (raw: AiRequest): string => {
    const { request, privatePage } = withoutPrivatePage(raw, privacyChecker({ get: (id) => repo.get(id) }))
    const pageToMarkdown = (id: string, hidden?: (id: string) => boolean): { title: string; markdown: string } =>
      markdown.pageToMarkdown(repo, id, hidden ? { hidden } : {})
    const loaded = loadContext(
      {
        get: (id) => repo.get(id),
        pageToMarkdown,
        blocksToMarkdown: (blocks, hidden) => markdown.blocksToMarkdown(repo, blocks, hidden ? { hidden } : {})
      },
      request
    )
    const standing = loadStanding({ getSetting: (key) => repo.getSetting(key), get: (id) => repo.get(id), pageToMarkdown })
    const context: PromptContext = {
      ...loaded,
      ...(standing ? { standing } : {}),
      ...buildWorkspace(source, request, new Date(), { privatePage })
    }
    return buildPrompt(request, context, { nonce: 'n0nce', tools: true })
  }

  it('never carries a private page, its sub-pages, its databases or a private project, whatever is asked', () => {
    const prompt = promptFor({ action: 'ask', instruction: 'What is in my garden diary, the dream, the ledger and the appointment?' })
    expect(prompt).toContain('Projects')
    expect(prompt).toContain('Water the garden'.split(' ')[0])
    expectNoSecret(prompt, 'a question about the workspace')
  })

  it('leaves a private sub-page and a private database out of the page that holds them', () => {
    const prompt = promptFor({ action: 'summarize', pageId: projects.id })
    expect(prompt).toContain('Current work on the garden')
    expectNoSecret(prompt, 'the page holding private ones')
  })

  it('answers a question asked on a private page without the page, its selection or its blocks', () => {
    const quixotic = repo.children(diary.id).find((block) => block.type === 'text')!
    const prompt = promptFor({
      action: 'ask',
      instruction: 'Summarize this',
      pageId: diary.id,
      blockIds: [quixotic.id],
      selectionText: 'The garden plan I keep to myself: Quixotic'
    })
    expect(prompt).toContain('private from the AI')
    expectNoSecret(prompt, 'a question on a private page')
  })

  it('refuses anything else about a private page, or inside one', () => {
    for (const action of ['summarize', 'title', 'improve'] as const) {
      expect(() => promptFor({ action, pageId: diary.id })).toThrow(AI_PRIVATE_PAGE_MESSAGE)
      expect(() => promptFor({ action, pageId: dream.id })).toThrow(AI_PRIVATE_PAGE_MESSAGE)
    }
    expect(() => promptFor({ action: 'consolidate', pageId: dream.id, transcript: 'Marzipan talk' })).toThrow(AI_PRIVATE_PAGE_MESSAGE)
    // The floor under it: loadContext refuses one too.
    expect(() =>
      loadContext(
        { get: (id) => repo.get(id), pageToMarkdown: () => ({ title: '', markdown: '' }), blocksToMarkdown: () => '' },
        {
          action: 'summarize',
          pageId: diary.id
        }
      )
    ).toThrow(AI_PRIVATE_PAGE_MESSAGE)
  })

  it('leaves out a pinned page that is private, and keeps the others', () => {
    const notes = page('Pinned notes', null)
    text('About the garden', notes.id)
    repo.setSetting(AI_CONTEXT_KEY, 'I garden.')
    repo.setSetting(AI_CONTEXT_PAGES_KEY, [diary.id, dream.id, notes.id])
    const standing = loadStanding({
      getSetting: (key) => repo.getSetting(key),
      get: (id) => repo.get(id),
      pageToMarkdown: (id, hidden) => markdown.pageToMarkdown(repo, id, hidden ? { hidden } : {})
    })
    expect(standing?.pages?.map((pinned) => pinned.id)).toEqual([notes.id])
    expectNoSecret(promptFor({ action: 'ask', instruction: 'garden' }), 'the pinned pages')
  })

  it('reads the rows of a public project and leaves the private one out of a database page', () => {
    const prompt = promptFor({ action: 'summarize', pageId: tasks.id })
    expect(prompt).toContain('Water the garden')
    expectNoSecret(prompt, 'the task database')
  })
})

describe('the workspace tools', () => {
  const call = (name: string, args: Record<string, unknown> = {}): string => {
    try {
      return callTool(source, name, args)
    } catch (err) {
      if (err instanceof ToolError) return `ERROR ${err.message}`
      throw err
    }
  }

  it('never list, find or audit what is private', () => {
    expectNoSecret(call('search', { query: 'garden' }), 'search')
    // Searched for by its own words, it is not there (the answer only repeats the query).
    for (const query of SECRETS) expect(call('search', { query })).toBe(`Nothing matches “${query}”.`)
    expectNoSecret(call('outline', { depth: 4 }), 'outline')
    expectNoSecret(call('outline', { root: projects.id, depth: 4 }), 'outline of the parent')
    expectNoSecret(call('recent', { limit: 50 }), 'recent')
    expectNoSecret(call('audit'), 'audit')
    expect(call('search', { query: 'garden' })).toContain('Projects')
  })

  it('say "private" when asked for one by id, and read the rest without it', () => {
    for (const id of [diary.id, dream.id, ledger.id]) {
      expect(call('read_page', { id })).toBe(`ERROR ${AI_PRIVATE_MESSAGE}`)
      expect(call('outline', { root: id })).toMatch(/^ERROR /)
    }
    expect(call('read_database', { id: ledger.id })).toBe(`ERROR ${AI_PRIVATE_MESSAGE}`)
    const parent = call('read_page', { id: projects.id })
    expect(parent).toContain('Current work on the garden')
    expectNoSecret(parent, 'read_page of the parent')
    const list = call('read_database', { id: tasks.id })
    expect(list).toContain('Water the garden')
    expectNoSecret(list, 'read_database of the tasks')
    expect(toolActivity(source, 'read_page', { id: diary.id })).toBe('reading a page')
  })
})

describe('sel for other apps (MCP)', () => {
  // The endpoint runs these same two functions (external/service.ts).
  const run = (name: string, args: Record<string, unknown>): string => {
    try {
      return name === 'create_page' || name.includes('database_row') || name === 'append_to_page'
        ? callWriteTool({ repo, markdown }, name, args)
        : callTool(source, name, args)
    } catch (err) {
      if (err instanceof ToolError) return `ERROR ${err.message}`
      throw err
    }
  }

  it('hides it from reading, as for Claude', () => {
    expectNoSecret(run('search', { query: 'garden' }), 'search over MCP')
    expect(run('read_page', { id: diary.id })).toBe(`ERROR ${AI_PRIVATE_MESSAGE}`)
  })

  it('refuses to write into it', () => {
    const before = repo.children(diary.id).length
    expect(run('append_to_page', { id: diary.id, markdown: 'more' })).toBe(`ERROR ${AI_PRIVATE_MESSAGE}`)
    expect(run('create_page', { parent: dream.id, title: 'Inside' })).toBe(`ERROR ${AI_PRIVATE_MESSAGE}`)
    expect(run('add_database_row', { database: ledger.id, values: { Name: 'x' } })).toBe(`ERROR ${AI_PRIVATE_MESSAGE}`)
    expect(run('update_database_row', { id: secretRow.id, values: { Name: 'x' } })).toBe(`ERROR ${AI_PRIVATE_MESSAGE}`)
    expect(repo.children(diary.id)).toHaveLength(before)
    expect(run('update_database_row', { id: publicRow.id, values: { Name: 'Water the garden twice' } })).toContain('Updated')
  })
})

describe('what is not the AI', () => {
  it('exports a private page in full: the mark is about the AI only', () => {
    const { markdown: out } = markdown.pageToMarkdown(repo, projects.id)
    expect(out).toContain('Zanzibar diary')
    expect(out).toContain('Obsidian ledger')
  })
})
