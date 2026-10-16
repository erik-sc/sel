import { beforeEach, describe, expect, it } from 'vitest'
import type { Block } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import * as markdown from '../markdown'
import { buildWorkspace } from './context'
import { callTool, repositorySource, type ToolSource } from './tools'

// What the assistant (Herman's answers, and the MCP tools, which share these) sees of archived
// pages: only what it finds by searching, never what it is shown by itself.

let repo: Repository
let source: ToolSource
let archived: Block
let shelf: Block

beforeEach(() => {
  repo = openTestRepository()
  source = repositorySource(repo, markdown)
  const projects = repo.create({ type: 'page', parentId: null, props: { title: [['Projects']] } })
  repo.create({ type: 'text', parentId: projects.id, props: { title: [['Current work']] } })
  archived = repo.create({ type: 'page', parentId: projects.id, props: { title: [['Otter census']] } })
  repo.create({ type: 'text', parentId: archived.id, props: { title: [['Counting otters along the river']] } })
  shelf = repo.create({ type: 'database', parentId: archived.id, props: { title: [['Otter sightings']] } })
  repo.update(archived.id, { props: { archivedAt: Date.now() } })
})

describe('archived pages and the assistant', () => {
  it('finds them when it searches, and says they are archived', () => {
    const found = callTool(source, 'search', { query: 'otters' })
    expect(found).toContain('Otter census')
    expect(found).toContain('(archived)')
  })

  it('leaves them out of the outline, the recent pages and the audit', () => {
    for (const tool of ['outline', 'recent', 'audit']) {
      const out = callTool(source, tool, { depth: 4 })
      expect(out, tool).not.toContain('Otter')
    }
  })

  it('leaves them out of the context it is given with a question', () => {
    const { workspace, related } = buildWorkspace(source, { action: 'ask', instruction: 'How many otters did we count?' })
    expect(workspace).toContain('Projects')
    expect(workspace).not.toContain('Otter')
    expect(related ?? '').not.toContain('Otter')
  })

  it('still reads one by id when asked to', () => {
    expect(callTool(source, 'read_page', { id: archived.id })).toContain('Counting otters')
    expect(callTool(source, 'read_database', { id: shelf.id })).toContain('Otter sightings')
  })
})
