/**
 * Export as a zip, then import that zip as an Obsidian vault: the same titles, nested the same
 * way and in the same order, linking to the same pages, and the databases with their rows and
 * values. Also what the zip holds for Obsidian: Markdown in folders, CSV, the images, an index.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parsePageLink } from '../../shared/pageLink'
import type { Block, Mark } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { PNG } from './fixtures'
import { exportZip } from './exportZip'
import { planImport } from './plan'
import { runImport } from './run'
import { zipSource } from './source'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-roundtrip-'))
const FILES = join(ROOT, 'files')
mkdirSync(FILES)
writeFileSync(join(FILES, 'pic-1.png'), PNG)
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const WORDS = { archive: 'Archive', indexTitle: 'Index' }
const titleOf = (b: Block): string => (b.props.title ?? []).map((s) => s[0]).join('')
const link = (text: string, id: string): [string, Mark[]] => [text, [['a', `sel://page/${id}`]]]

interface Shape {
  title: string
  type: string
  children: Shape[]
}

/** The pages and databases under `id` (or the workspace), with their titles, in order. */
function shape(repo: Repository, blocks: Block[]): Shape[] {
  return blocks
    .filter((b) => (b.type === 'page' || b.type === 'database') && b.trashedAt === null)
    .map((b) => ({ title: titleOf(b), type: b.type, children: shape(repo, repo.children(b.id)) }))
}

/** Each link between pages, as the titles of the page it is on and the page it goes to. */
function links(repo: Repository, blocks: Block[], out: string[] = []): string[] {
  for (const page of blocks.filter((b) => b.type === 'page' || b.type === 'database')) {
    for (const block of repo.children(page.id)) {
      for (const [text, marks] of block.props.title ?? []) {
        for (const mark of marks ?? []) {
          const target = mark[0] === 'a' ? parsePageLink(mark[1]) : null
          if (target)
            out.push(`${titleOf(page)} → ${text} → ${(repo.get(target.pageId) && titleOf(repo.get(target.pageId) as Block)) || '?'}`)
        }
      }
    }
    links(repo, repo.children(page.id), out)
  }
  return out
}

function workspace(): { repo: Repository; notes: Block; tasks: Block } {
  const repo = openTestRepository()
  const page = (title: string, parentId: string | null = null): Block =>
    repo.create({ type: 'page', parentId, props: { title: [[title]] } })
  const notes = page('Notes')
  const other = page('Other: ideas?')
  repo.create({ type: 'text', parentId: notes.id, props: { title: [['Read '], link('the ideas', other.id), [' first.']] } })
  const child = page('Child page', notes.id)
  repo.create({ type: 'text', parentId: notes.id, props: { title: [['Between the sub-pages.']] } })
  const second = page('Another child', notes.id)
  page('Grandchild', child.id)
  repo.create({ type: 'text', parentId: second.id, props: { title: [['Back to '], link('notes', notes.id)] } })
  repo.create({ type: 'image', parentId: other.id, props: { url: 'sel-file://files/pic-1.png' } })
  const tasks = repo.create({
    type: 'database',
    parentId: notes.id,
    props: {
      title: [['Tasks']],
      schema: {
        title: { id: 'title', name: 'Name', type: 'title' },
        status: {
          id: 'status',
          name: 'Status',
          type: 'select',
          options: [
            { id: 'todo', name: 'To do', color: 'gray' },
            { id: 'done', name: 'Done', color: 'green' }
          ]
        },
        ok: { id: 'ok', name: 'Checked', type: 'checkbox' },
        due: { id: 'due', name: 'Due', type: 'date' },
        n: { id: 'n', name: 'Points', type: 'number' }
      }
    }
  })
  const row = repo.create({
    type: 'page',
    parentId: tasks.id,
    props: { title: [['Write it']], values: { status: 'todo', ok: false, due: { start: '2026-10-22' }, n: 3 } }
  })
  repo.create({ type: 'text', parentId: row.id, props: { title: [['See '], link('other', other.id)] } })
  repo.create({ type: 'page', parentId: tasks.id, props: { title: [['Ship it']], values: { status: 'done', ok: true, n: 5 } } })
  return { repo, notes, tasks }
}

async function roundTrip(repo: Repository, rootId?: string): Promise<{ again: Repository; root: Block; zip: string }> {
  const zip = join(ROOT, `${Math.random().toString(36).slice(2)}.zip`)
  await exportZip(repo, zip, FILES, { words: WORDS, rootId })
  const again = openTestRepository()
  const source = await zipSource(zip)
  const plan = await planImport(source, 'obsidian')
  const result = await runImport(again, plan, { title: 'Imported', storeImage: async () => 'sel-file://files/copy.png' })
  await source.close()
  return { again, root: again.get(result.pageId) as Block, zip }
}

describe('export as a zip, then import it', () => {
  it('keeps the titles, the nesting, the order and the links', async () => {
    const { repo } = workspace()
    const { again, root } = await roundTrip(repo)
    const before = shape(repo, repo.listRoot())
    const after = shape(again, again.children(root.id))
    // Rows without writing of their own are only in the table: compare pages and databases, then rows.
    const pagesOnly = (list: Shape[]): Shape[] => list.map((s) => ({ ...s, children: s.type === 'database' ? [] : pagesOnly(s.children) }))
    expect(pagesOnly(after)).toEqual(pagesOnly(before))
    expect(links(again, again.children(root.id)).sort()).toEqual(links(repo, repo.listRoot()).sort())
    // Sub-pages sit where they were among the text.
    const notes = again.children(root.id).find((b) => titleOf(b) === 'Notes') as Block
    expect(again.children(notes.id).map((b) => (b.type === 'text' ? 'text' : titleOf(b)))).toEqual([
      'text',
      'Child page',
      'text',
      'Another child',
      'Tasks'
    ])
    // The image came along.
    const other = again.children(root.id).find((b) => titleOf(b) === 'Other: ideas?') as Block
    expect(again.children(other.id)[0]).toMatchObject({ type: 'image', props: { url: 'sel-file://files/copy.png' } })
  })

  it('keeps a database: its rows, its columns and their types, its values', async () => {
    const { repo } = workspace()
    const { again, root } = await roundTrip(repo)
    const notes = again.children(root.id).find((b) => titleOf(b) === 'Notes') as Block
    const tasks = again.children(notes.id).find((b) => b.type === 'database') as Block
    expect(titleOf(tasks)).toBe('Tasks')
    const schema = Object.values(tasks.props.schema ?? {})
    expect(schema.map((p) => `${p.name}:${p.type}`)).toEqual([
      'Name:title',
      'Status:select',
      'Checked:checkbox',
      'Due:date',
      'Points:number'
    ])
    const rows = again.children(tasks.id)
    expect(rows.map(titleOf)).toEqual(['Write it', 'Ship it'])
    const status = schema[1]
    const optionName = (id: unknown): string | undefined => status.options?.find((o) => o.id === id)?.name
    expect(optionName(rows[0].props.values?.[status.id])).toBe('To do')
    expect(optionName(rows[1].props.values?.[status.id])).toBe('Done')
    expect(rows[1].props.values?.[schema[2].id]).toBe(true)
    expect(rows[0].props.values?.[schema[3].id]).toEqual({ start: '2026-10-22' })
    expect(rows[0].props.values?.[schema[4].id]).toBe(3)
    // The row with writing of its own kept it, and its link.
    expect(links(again, [rows[0]])).toEqual(['Write it → other → Other: ideas?'])
  })

  it('of one page takes only what is under it', async () => {
    const { repo, notes } = workspace()
    const { again, root, zip } = await roundTrip(repo, notes.id)
    expect(shape(again, again.children(root.id)).map((s) => s.title)).toEqual(['Notes'])
    const source = await zipSource(zip)
    const paths = source.files.map((f) => f.path)
    await source.close()
    expect(paths).toContain('index.md')
    expect(paths).toContain('Notes/Tasks.csv')
    expect(paths).not.toContain('Other ideas.md')
    // The link to a page outside stays a link into sel.
    expect(links(again, again.children(root.id))).toContain('Notes → the ideas → ?')
  })

  it('writes a zip that reads well in Obsidian', async () => {
    const { repo } = workspace()
    const zip = join(ROOT, 'look.zip')
    const written = await exportZip(repo, zip, FILES, { words: WORDS })
    expect(written).toEqual({ pages: 6, databases: 1, images: 1 })
    const source = await zipSource(zip)
    const read = async (path: string): Promise<string> => {
      const file = source.files.find((f) => f.path === path)
      if (!file) throw new Error(`${path} not in ${source.files.map((f) => f.path).join(', ')}`)
      return (await file.read(1_000_000)).toString('utf8')
    }
    expect(source.files.map((f) => f.path).sort()).toEqual([
      'Notes.md',
      'Notes/Another child.md',
      'Notes/Child page.md',
      'Notes/Child page/Grandchild.md',
      'Notes/Tasks.csv',
      'Notes/Tasks.md',
      'Notes/Tasks/Write it.md',
      'Other ideas.md',
      'files/pic-1.png',
      'index.md'
    ])
    const notes = await read('Notes.md')
    expect(notes).toContain('[the ideas](Other%20ideas.md)')
    expect(notes).toContain('[Child page](Notes/Child%20page.md)')
    expect(notes).toContain('[Tasks](Notes/Tasks.md)')
    expect(await read('Other ideas.md')).toContain('](files/pic-1.png)')
    expect(await read('Notes/Tasks.csv')).toBe(
      '﻿Name,Status,Checked,Due,Points\r\nWrite it,To do,No,2026-10-22,3\r\nShip it,Done,Yes,,5\r\n'
    )
    const index = await read('index.md')
    expect(index.startsWith('---\nsel-export: index\n---\n\n# Index\n')).toBe(true)
    expect(index).toContain('    - [Grandchild](Notes/Child%20page/Grandchild.md)')
    await source.close()
  })
})
