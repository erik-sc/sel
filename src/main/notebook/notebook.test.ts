import { beforeEach, describe, expect, it } from 'vitest'
import { localDay } from '../../shared/briefing'
import { entryId, NOTEBOOK_ID } from '../../shared/notebook'
import type { Block } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { workspaceFromRows } from '../sync/format'
import { checkWorkspace, diffWorkspace, emptyWorkspace, mergeWorkspace } from '../sync/merge'
import { NotebookService } from './service'

/** Noon, local time, on a day of October 2026. */
const at = (date: number, hour = 12, minute = 0): number => new Date(2026, 9, date, hour, minute).getTime()

let clock: { t: number }
let repo: Repository
let notebook: NotebookService

function open(start: number): { clock: { t: number }; repo: Repository; notebook: NotebookService } {
  const c = { t: start }
  const r = openTestRepository(':memory:', { clock: () => c.t })
  return { clock: c, repo: r, notebook: new NotebookService({ repo: r, now: () => c.t, systemLocale: () => 'en-US' }) }
}

beforeEach(() => {
  ;({ clock, repo, notebook } = open(at(15)))
})

const today = (): string => localDay(clock.t)

describe('the notebook page', () => {
  it('is started on first use with its fixed id, once', () => {
    expect(repo.get(NOTEBOOK_ID)).toBeNull()
    expect(notebook.get().entries).toEqual([])
    // Reading starts nothing.
    expect(repo.get(NOTEBOOK_ID)).toBeNull()
    notebook.ensure()
    notebook.ensure()
    notebook.write(today(), 'first line')
    const root = repo.get(NOTEBOOK_ID) as Block
    expect(root).toMatchObject({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { system: 'notebook', title: [['Ink notebook']] } })
    expect(repo.rootOrder().order.filter((id) => id === NOTEBOOK_ID)).toHaveLength(1)
    expect(root.content).toEqual([entryId(today())])
  })

  it('takes its name in the language of the screens', () => {
    const pt = open(at(15))
    pt.repo.setSetting('ai.language', 'pt-BR')
    pt.notebook.ensure()
    expect(pt.repo.get(NOTEBOOK_ID)?.props.title).toEqual([['Caderno de tinta']])
  })

  it('cannot be trashed, deleted for good, moved into a page or made twice', () => {
    notebook.ensure()
    const other = repo.create({ type: 'page', parentId: null, props: { title: [['Other']] } })
    expect(() => repo.delete(NOTEBOOK_ID)).toThrow(/cannot be deleted/)
    expect(() => repo.apply([{ op: 'delete', id: NOTEBOOK_ID }])).toThrow(/cannot be deleted/)
    expect(() => repo.deleteForever(NOTEBOOK_ID)).toThrow(/cannot be deleted/)
    expect(() => repo.move(NOTEBOOK_ID, other.id)).toThrow(/cannot be moved/)
    expect(() => repo.update(NOTEBOOK_ID, { props: { system: null } })).toThrow(/cannot stop being one/)
    expect(repo.get(NOTEBOOK_ID)?.trashedAt).toBeNull()
    // Only the page with the fixed id is the notebook.
    expect(() => repo.create({ type: 'page', parentId: null, props: { system: 'notebook' } })).toThrow(/page of its own/)
    expect(() => repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { system: 'notebook' } })).toThrow(/already exists/)
  })

  it('refuses to start over a block that took its id', () => {
    repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { title: [['Mine']] } })
    expect(() => notebook.ensure()).toThrow(/could not be opened/)
    // An ordinary page with that id holds whatever it likes: the rules are the notebook's only.
    expect(() => repo.create({ type: 'text', parentId: NOTEBOOK_ID, props: { title: [['free']] } })).not.toThrow()
  })
})

describe('a day of the notebook', () => {
  it('is written, rewritten and taken back while it lasts', () => {
    expect(notebook.write(today(), '  the river was high  ').text).toBe('the river was high')
    expect(notebook.write(today(), 'the river was higher').text).toBe('the river was higher')
    expect(notebook.get().entries.map((e) => e.text)).toEqual(['the river was higher'])
    notebook.write(today(), '')
    expect(notebook.get().entries).toEqual([])
    expect(notebook.get().todayEntry).toMatchObject({ day: today(), text: '' })
  })

  it('is not created by an empty line', () => {
    notebook.write(today(), '   ')
    expect(repo.get(entryId(today()))).toBeNull()
  })

  it('is ink once it has ended, whoever writes', () => {
    notebook.write(today(), 'written on the 15th')
    const id = entryId('2026-10-15')
    clock.t = at(16, 0, 0)
    expect(() => notebook.write('2026-10-15', 'changed')).toThrow(/has ended/)
    expect(() => repo.update(id, { props: { title: [['changed']] } })).toThrow(/has ended/)
    expect(() => repo.apply([{ op: 'update', id, patch: { props: { title: [['changed']] } } }])).toThrow(/has ended/)
    expect(() => repo.update(id, { type: 'heading_1' })).toThrow(/has ended/)
    expect(() => repo.delete(id)).toThrow(/has ended/)
    expect(() => repo.deleteForever(id)).toThrow(/has ended/)
    expect(() => repo.move(id, NOTEBOOK_ID, null)).toThrow(/stays where it was written/)
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Elsewhere']] } })
    expect(() => repo.move(id, page.id)).toThrow(/stays where it was written/)
    expect(repo.get(id)?.props.title).toEqual([['written on the 15th']])
    expect(notebook.get().entries.map((e) => e.day)).toEqual(['2026-10-15'])
  })

  it('cannot be written for a day that has ended or before it comes', () => {
    notebook.ensure()
    expect(() => notebook.write('2026-10-14', 'late')).toThrow(/has ended/)
    expect(() => notebook.write('2026-10-16', 'early')).toThrow(/once it comes/)
    expect(() => repo.create({ id: entryId('2026-10-14'), type: 'text', parentId: NOTEBOOK_ID, props: { title: [['backdated']] } })).toThrow(/has ended/)
    expect(() => notebook.write('yesterday', 'x')).toThrow(/Invalid day/)
  })

  it('is the only thing the notebook holds, and holds nothing itself', () => {
    notebook.write(today(), 'a line')
    const id = entryId(today())
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Notes']] } })
    const loose = repo.create({ type: 'text', parentId: page.id, props: { title: [['loose']] } })
    expect(() => repo.create({ type: 'text', parentId: NOTEBOOK_ID, props: { title: [['random id']] } })).toThrow(/one line a day/)
    expect(() => repo.create({ id: entryId('2026-10-16'), type: 'to_do', parentId: NOTEBOOK_ID })).toThrow(/one line a day/)
    expect(() => repo.create({ type: 'text', parentId: id, props: { title: [['nested']] } })).toThrow(/holds its line/)
    expect(() => repo.createTree({ type: 'text', props: { title: [['tree']] } }, NOTEBOOK_ID)).toThrow(/Nothing can be added/)
    expect(() => repo.move(loose.id, NOTEBOOK_ID)).toThrow(/Nothing can be moved into/)
    expect(() => repo.move(loose.id, id)).toThrow(/Nothing can be moved into/)
    expect(() => repo.update(id, { type: 'heading_1' })).toThrow(/stays a line/)
  })

  it('may be removed by a writer while the day lasts', () => {
    notebook.write(today(), 'a line')
    repo.delete(entryId(today()))
    expect(repo.get(entryId(today()))).toBeNull()
  })

  it('keeps the notebook from going back to an earlier version', () => {
    notebook.write(today(), 'first')
    const version = repo.saveVersion(NOTEBOOK_ID, 'before')
    notebook.write(today(), 'second')
    expect(() => repo.restoreVersion(version.id, 'replace')).toThrow(/written in ink/)
    expect(repo.get(entryId(today()))?.props.title).toEqual([['second']])
  })

  it('arrives from another device through sync even when its day has ended here', () => {
    notebook.ensure()
    clock.t = at(17)
    const late: Block = { id: entryId('2026-10-15'), type: 'text', parentId: NOTEBOOK_ID, content: [], props: { title: [['written elsewhere']] }, createdAt: at(15), updatedAt: at(15, 23), trashedAt: null }
    const root = repo.get(NOTEBOOK_ID) as Block
    repo.applySync({ put: [{ ...root, content: [late.id] }, late], remove: [], snapshots: [], foreign: [], resetPages: [], settings: {} })
    expect(notebook.get().entries.map((e) => [e.day, e.text])).toEqual([['2026-10-15', 'written elsewhere']])
  })
})

describe('on this day', () => {
  it('shows the lines of the same date in earlier years under today', () => {
    for (const [year, text] of [
      [2024, 'two years ago'],
      [2025, 'a year ago']
    ] as const) {
      clock.t = new Date(year, 9, 15, 9).getTime()
      notebook.write(localDay(clock.t), text)
    }
    clock.t = new Date(2025, 9, 16, 9).getTime()
    notebook.write(localDay(clock.t), 'the day after')
    clock.t = at(15)
    const view = notebook.get()
    expect(view.today).toBe('2026-10-15')
    expect(view.onThisDay.map((o) => [o.years, o.entry.text])).toEqual([
      [1, 'a year ago'],
      [2, 'two years ago']
    ])
    expect(view.entries.map((e) => e.day)).toEqual(['2025-10-16', '2025-10-15', '2024-10-15'])
  })
})

describe('two devices', () => {
  it('that start the notebook on their own merge into one page with every day', () => {
    const a = open(at(15, 9))
    const b = open(at(15, 10))
    a.notebook.write('2026-10-15', 'from the desk')
    b.clock.t = at(16, 8)
    b.notebook.write('2026-10-16', 'from the laptop')
    const wsA = workspaceFromRows(a.repo.syncRows(), a.repo.rootOrder())
    const wsB = workspaceFromRows(b.repo.syncRows(), b.repo.rootOrder())
    const { result, conflicts } = mergeWorkspace(emptyWorkspace(), wsA, wsB)
    expect(checkWorkspace(result)).toEqual([])
    expect(result.root.filter((id) => id === NOTEBOOK_ID)).toHaveLength(1)
    expect([...(result.blocks.get(NOTEBOOK_ID)?.content ?? [])].sort()).toEqual([entryId('2026-10-15'), entryId('2026-10-16')])
    // Only the page itself was made twice; the days do not collide.
    expect(conflicts.every((c) => c.blockId === NOTEBOOK_ID)).toBe(true)

    // Device A takes the merged workspace, a day later than both lines.
    a.clock.t = at(17)
    const diff = diffWorkspace(wsA, result)
    a.repo.applySync({ put: diff.put as Block[], remove: diff.remove, root: { order: result.root, at: result.rootAt ?? 0 }, snapshots: [], foreign: [], resetPages: [], settings: {} })
    expect(a.notebook.get().entries.map((e) => [e.day, e.text])).toEqual([
      ['2026-10-16', 'from the laptop'],
      ['2026-10-15', 'from the desk']
    ])
    expect(a.repo.listRoot().filter((block) => block.id === NOTEBOOK_ID)).toHaveLength(1)
  })

  it('that both wrote the same day keep one line for it, the later one', () => {
    const a = open(at(15, 9))
    const b = open(at(15, 21))
    a.notebook.write('2026-10-15', 'morning version')
    b.notebook.write('2026-10-15', 'evening version')
    const wsA = workspaceFromRows(a.repo.syncRows(), a.repo.rootOrder())
    const wsB = workspaceFromRows(b.repo.syncRows(), b.repo.rootOrder())
    const { result } = mergeWorkspace(emptyWorkspace(), wsA, wsB)
    expect(checkWorkspace(result)).toEqual([])
    expect(result.blocks.get(NOTEBOOK_ID)?.content).toEqual([entryId('2026-10-15')])
    expect(result.blocks.get(entryId('2026-10-15'))?.props['title']).toEqual([['evening version']])
  })
})
