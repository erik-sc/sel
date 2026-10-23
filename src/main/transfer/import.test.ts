/**
 * Importing a Notion export and an Obsidian vault: the preview's counts, then the pages,
 * databases, links and images made, all under one page that the trash can take back.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { parsePageLink } from '../../shared/pageLink'
import type { Block, Mark } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { NOTION_EXPORT, OBSIDIAN_VAULT } from './fixtures'
import { planImport, splitFrontmatter } from './plan'
import { runImport, undoImport } from './run'
import { folderSource, memorySource, zipSource, type ImportSource } from './source'
import { ZipWriter } from './zip'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-import-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

let repo: Repository
beforeEach(() => {
  repo = openTestRepository()
})

const titleOf = (b: Block): string => (b.props.title ?? []).map((s) => s[0]).join('')
const pagesUnder = (id: string): Block[] => repo.children(id).filter((b) => b.type === 'page' || b.type === 'database')
const childNamed = (id: string, title: string): Block => {
  const found = pagesUnder(id).find((b) => titleOf(b) === title)
  if (!found) throw new Error(`No "${title}" under ${id}: ${pagesUnder(id).map(titleOf).join(', ')}`)
  return found
}
/** Every link mark in a page's own text blocks: [text, the page it points at]. */
const linksOn = (pageId: string): [string, string | null][] =>
  repo
    .children(pageId)
    .flatMap((b) => b.props.title ?? [])
    .flatMap(([text, marks]) =>
      (marks ?? []).filter((m: Mark) => m[0] === 'a').map((m): [string, string | null] => [text, parsePageLink(m[1])?.pageId ?? null])
    )
/** The text of a page's own blocks, sub-pages and databases left out. */
const textOf = (pageId: string): string =>
  repo
    .children(pageId)
    .filter((b) => b.type !== 'page' && b.type !== 'database')
    .map((b) => (b.props.title ?? []).map((s) => s[0]).join(''))
    .join('\n')

let stored = 0
async function make(source: ImportSource, format: 'notion' | 'obsidian') {
  const plan = await planImport(source, format)
  const result = await runImport(repo, plan, {
    title: 'Imported on 2026-10-22',
    storeImage: async (file) => {
      await file.read(1000)
      return `sel-file://files/image-${++stored}.png`
    }
  })
  return { plan, result, root: repo.get(result.pageId) as Block }
}

async function zipOf(entries: Record<string, string | Uint8Array>): Promise<string> {
  const path = join(ROOT, `${Math.random().toString(36).slice(2)}.zip`)
  const writer = await ZipWriter.create(path)
  for (const [name, content] of Object.entries(entries)) await writer.add(name, content)
  await writer.close()
  return path
}

describe('a Notion export', () => {
  it('previews what it will make', async () => {
    const plan = await planImport(memorySource('Export.zip', NOTION_EXPORT), 'notion')
    expect(plan.counts).toEqual({ pages: 6, databases: 1, attachments: 1, skipped: 1, unresolved: 1 })
    expect(plan.sourceName).toBe('Export.zip')
  })

  it('becomes pages and a database, with links, values and the image, under one page', async () => {
    const source = await zipSource(await zipOf(NOTION_EXPORT))
    const { root, result } = await make(source, 'notion')
    await source.close()
    expect(titleOf(root)).toBe('Imported on 2026-10-22')
    expect(root.parentId).toBeNull()
    expect(result.counts.attachments).toBe(1)
    expect(pagesUnder(root.id).map(titleOf)).toEqual(['Meeting', 'Projects'])

    const projects = childNamed(root.id, 'Projects')
    const meeting = childNamed(root.id, 'Meeting')
    // The ids are gone from the titles; the sub-page and the database sit where the text linked to them.
    expect(repo.children(projects.id).map((b) => (b.type === 'text' ? titleOf(b) : `${b.type}:${titleOf(b)}`))).toEqual([
      'Our projects live here.',
      'page:Roadmap',
      'database:Tasks',
      'See the meeting and a lost page.'
    ])
    // A notion.so address of an exported page links to it; the page not exported is text.
    expect(linksOn(projects.id)).toEqual([['the meeting', meeting.id]])

    const roadmap = childNamed(projects.id, 'Roadmap')
    const blocks = repo.children(roadmap.id)
    expect(blocks[0].type).toBe('image')
    expect(blocks[0].props.url).toMatch(/^sel-file:\/\/files\/image-\d+\.png$/)
    // The PDF cannot be kept: its link text stays.
    expect(textOf(roadmap.id)).toContain('The spec is attached.')

    const tasks = childNamed(projects.id, 'Tasks')
    expect(tasks.type).toBe('database')
    const schema = tasks.props.schema ?? {}
    expect(Object.values(schema).map((p) => `${p.name}:${p.type}`)).toEqual([
      'Name:title',
      'Status:select',
      'Tags:multi_select',
      'Due:date',
      'Done:checkbox',
      'Estimate:number'
    ])
    // `_all.csv` has the row the view hid.
    const rows = repo.children(tasks.id)
    expect(rows.map(titleOf)).toEqual(['Write spec', 'Ship it', 'Celebrate'])
    expect(rows[1].props.values?.p4).toBe(true)
    expect(rows[1].props.values?.p3).toEqual({ start: '2026-10-30T15:00' })
    // The row's page: its values are not repeated as text, its link goes to the sub-page.
    expect(textOf(rows[0].id)).toBe('The spec follows the roadmap.')
    expect(linksOn(rows[0].id)).toEqual([['roadmap', roadmap.id]])
  })

  it('is undone by putting its page in the trash', async () => {
    const { root } = await make(memorySource('Export.zip', NOTION_EXPORT), 'notion')
    expect(undoImport(repo, root.id)?.id).toBe(root.id)
    expect(repo.get(root.id)?.trashedAt).not.toBeNull()
    expect(repo.listRoot().some((b) => b.id === root.id)).toBe(false)
    expect(undoImport(repo, root.id)).toBeNull()
  })

  it('puts nothing in the workspace when it fails halfway', async () => {
    const plan = await planImport(memorySource('Export.zip', NOTION_EXPORT), 'notion')
    // A page that cannot be made: its id is taken.
    const taken = plan.nodes[1].children[0]
    repo.create({ id: taken.id, type: 'page', parentId: null, props: { title: [['In the way']] } })
    await expect(runImport(repo, plan, { title: 'Imported', storeImage: async () => 'sel-file://files/x.png' })).rejects.toThrow(
      'already exists'
    )
    expect(repo.listRoot().map(titleOf)).toEqual(['In the way'])
  })
})

describe('an Obsidian vault', () => {
  const vault = (): string => {
    const dir = mkdtempSync(join(ROOT, 'vault-'))
    for (const [path, content] of Object.entries(OBSIDIAN_VAULT)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    return dir
  }

  it('previews what it will make, leaving the app folder out', async () => {
    const source = await folderSource(vault())
    expect(source.files.some((f) => f.path.startsWith('.obsidian'))).toBe(false)
    const plan = await planImport(source, 'obsidian')
    expect(plan.counts).toEqual({ pages: 6, databases: 0, attachments: 1, skipped: 1, unresolved: 1 })
  })

  it('becomes pages nested as the folders, with wikilinks as links and embeds as images', async () => {
    const { root } = await make(await folderSource(vault()), 'obsidian')
    expect(pagesUnder(root.id).map(titleOf)).toEqual(['Daily', 'Home', 'Ideas', 'Projects'])
    const daily = childNamed(childNamed(root.id, 'Daily').id, '2026-10-22')
    const home = childNamed(root.id, 'Home')
    const ideas = childNamed(root.id, 'Ideas')
    const projects = childNamed(root.id, 'Projects')
    const alpha = childNamed(projects.id, 'Alpha')

    // Front matter: the emoji is the icon, the rest is listed; the title heading is not repeated.
    expect(home.props.icon).toBe('🏠')
    const homeText = textOf(home.id)
    expect(homeText.startsWith('tags: index, start')).toBe(true)
    expect(homeText).not.toContain('# Home')
    expect(linksOn(home.id)).toEqual([
      ['today', daily.id],
      ['Ideas', ideas.id]
    ])
    expect(repo.children(home.id).some((b) => b.type === 'image')).toBe(true)
    expect(homeText).toContain('The paper: paper.pdf')
    expect(homeText).toContain('Nowhere is not here.')
    // Code is left as it is.
    expect(repo.children(home.id).find((b) => b.type === 'code')?.props.title?.[0][0]).toBe('[[Not a link]] inside code')

    expect(linksOn(ideas.id)).toEqual([
      ['back home', home.id],
      ['Markdown link', daily.id]
    ])
    expect(linksOn(daily.id)).toEqual([['Ideas', ideas.id]])
    expect(linksOn(alpha.id)).toEqual([['Projects', projects.id]])
    expect(textOf(projects.id)).toBe('All projects.')
  })

  it('reads the simple shapes of front matter', () => {
    const { data, rest } = splitFrontmatter('---\ntitle: "Quoted"\naliases:\n  - One\n  - Two\ntags: [a, "b"]\n---\nBody')
    expect(data).toEqual([
      ['title', 'Quoted'],
      ['aliases', 'One, Two'],
      ['tags', 'a, b']
    ])
    expect(rest).toBe('Body')
    expect(splitFrontmatter('No front matter').rest).toBe('No front matter')
  })
})
