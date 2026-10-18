/**
 * Export everything as Markdown: which files, where, with which links; and the writing of them.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Block } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { makeExportFolder, planExport, relativeLink, writeExport, type ExportPlan } from './exportAll'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-export-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

let repo: Repository
const page = (title: string, parentId: string | null = null): Block => repo.create({ type: 'page', parentId, props: { title: [[title]] } })
const text = (parentId: string, title: Block['props']['title']): Block => repo.create({ type: 'text', parentId, props: { title } })
const paths = (plan: ExportPlan): string[] => plan.files.map((f) => f.path.join('/'))
const fileAt = (plan: ExportPlan, path: string): string => plan.files.find((f) => f.path.join('/') === path)?.text ?? ''
const WORDS = { archive: 'Archive' }

beforeEach(() => {
  repo = openTestRepository()
})

describe('relative links', () => {
  it('go up and down the folders, with the characters a link cannot hold escaped', () => {
    expect(relativeLink(['A.md'], ['B.md'])).toBe('B.md')
    expect(relativeLink(['A.md'], ['A', 'Sub page.md'])).toBe('A/Sub%20page.md')
    expect(relativeLink(['A', 'Sub.md'], ['A.md'])).toBe('../A.md')
    expect(relativeLink(['A', 'B', 'C.md'], ['files', 'x.png'])).toBe('../../files/x.png')
    expect(relativeLink(['A', 'x.md'], ['A', 'Notes (draft).md'])).toBe('Notes%20%28draft%29.md')
  })
})

describe('the plan of an export', () => {
  it('writes each page once, sub-pages in a folder of the same name', () => {
    const notes = page('Notes')
    const child = page('Child', notes.id)
    page('Grandchild', child.id)
    page('Other')
    text(notes.id, [['Some writing']])
    const plan = planExport(repo, WORDS)
    expect(paths(plan)).toEqual(['Notes.md', 'Notes/Child.md', 'Notes/Child/Grandchild.md', 'Other.md'])
    expect(fileAt(plan, 'Notes.md')).toContain('Some writing')
  })

  it('makes links between pages and to images relative, and lists the images', () => {
    const notes = page('Notes')
    const child = page('Child page', notes.id)
    const other = page('Other')
    text(child.id, [['see '], ['this', [['a', `sel://page/${other.id}`]]], [' and '], ['a lost one', [['a', 'sel://page/nowhere']]]])
    repo.create({ type: 'image', parentId: child.id, props: { url: 'sel-file://files/abc-123.png' } })
    const plan = planExport(repo, WORDS)
    const written = fileAt(plan, 'Notes/Child page.md')
    expect(written).toContain('[this](../Other.md)')
    expect(written).toContain('](../files/abc-123.png)')
    // A link to a page that is not exported stays as it was.
    expect(written).toContain('(sel://page/nowhere)')
    // The parent page links to its sub-page.
    expect(fileAt(plan, 'Notes.md')).toContain('(Notes/Child%20page.md)')
    expect(plan.images).toEqual(['abc-123.png'])
  })

  it('gives pages of the same name their own files, never the images folder', () => {
    page('Same')
    page('same')
    page('files')
    page('Con')
    page('a/b: c?')
    expect(paths(planExport(repo, WORDS))).toEqual(['Same.md', 'same (2).md', 'files (2).md', 'Untitled.md', 'a b c.md'])
  })

  it('puts archived pages in their own folder and leaves the trash out', () => {
    const kept = page('Kept')
    const old = page('Old')
    page('Under old', old.id)
    const nested = page('Nested archived', kept.id)
    const gone = page('Gone')
    repo.update(old.id, { props: { archivedAt: 1 } })
    repo.update(nested.id, { props: { archivedAt: 2 } })
    repo.delete(gone.id)
    expect(paths(planExport(repo, WORDS))).toEqual(['Kept.md', 'Archive/Nested archived.md', 'Archive/Old.md', 'Archive/Old/Under old.md'])
  })

  it('writes a database as a table, and a file only for rows with writing of their own', () => {
    const db = repo.create({ type: 'database', parentId: null, props: { title: [['Reading']] } })
    page('Plain row', db.id)
    const written = page('Row with notes', db.id)
    text(written.id, [['What I thought']])
    const plan = planExport(repo, WORDS)
    expect(paths(plan)).toEqual(['Reading.md', 'Reading/Row with notes.md'])
    expect(fileAt(plan, 'Reading.md')).toContain('Plain row')
    expect(fileAt(plan, 'Reading/Row with notes.md')).toContain('What I thought')
  })
})

describe('writing an export', () => {
  it('writes the files and copies the images that exist', async () => {
    const notes = page('Notes')
    const child = page('Child', notes.id)
    repo.create({ type: 'image', parentId: child.id, props: { url: 'sel-file://files/here.png' } })
    repo.create({ type: 'image', parentId: child.id, props: { url: 'sel-file://files/missing.png' } })
    const filesDir = join(ROOT, 'app-files')
    mkdirSync(filesDir, { recursive: true })
    writeFileSync(join(filesDir, 'here.png'), 'png')

    const root = await makeExportFolder(ROOT, 'sel export')
    expect(await makeExportFolder(ROOT, 'sel export')).toBe(join(ROOT, 'sel export (2)'))
    const result = await writeExport(planExport(repo, WORDS), root, filesDir)
    expect(result).toEqual({ pages: 2, images: 1 })
    expect(readFileSync(join(root, 'Notes', 'Child.md'), 'utf8')).toContain('](../files/here.png)')
    expect(readdirSync(join(root, 'files'))).toEqual(['here.png'])
  })
})
