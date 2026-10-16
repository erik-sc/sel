import { describe, expect, it } from 'vitest'
import { NOTEBOOK_ID } from '../../shared/notebook'
import type { Block, RichText } from '../../shared/types'
import type { Repository } from '../db/repository'
import { openTestRepository } from '../db/testing'
import { workspaceFromRows } from '../sync/format'
import { checkWorkspace, mergeWorkspace } from '../sync/merge'
import { NotebookService } from './service'
import { migrateNotebookTitle } from './title'

const at = (date: number, hour = 12): number => new Date(2026, 9, date, hour).getTime()

function open(start: number): { clock: { t: number }; repo: Repository } {
  const clock = { t: start }
  return { clock, repo: openTestRepository(':memory:', { clock: () => clock.t }) }
}

/** The notebook page as a build before 0.6.0 made it. */
function oldNotebook(repo: Repository, title: RichText): void {
  repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { system: 'notebook', title } })
}

const titleOf = (repo: Repository): unknown => repo.get(NOTEBOOK_ID)?.props.title

describe('the notebook page renamed to Meditations', () => {
  it('takes the new name when it still has the old default one, in either language', () => {
    const en = open(at(15))
    oldNotebook(en.repo, [['Ink notebook']])
    expect(migrateNotebookTitle(en.repo)).toBe(true)
    expect(titleOf(en.repo)).toEqual([['Meditations']])

    const pt = open(at(15))
    oldNotebook(pt.repo, [['Caderno de tinta']])
    expect(migrateNotebookTitle(pt.repo)).toBe(true)
    expect(titleOf(pt.repo)).toEqual([['Meditações']])
  })

  it('follows the old title, not the language of this device', () => {
    const { repo } = open(at(15))
    repo.setSetting('ai.language', 'pt-BR')
    oldNotebook(repo, [['Ink notebook']])
    migrateNotebookTitle(repo)
    expect(titleOf(repo)).toEqual([['Meditations']])
  })

  it('leaves a title the user chose as it is', () => {
    for (const title of [[['My journal']], [['ink notebook']], [['Ink notebook ']], [['Ink notebook', [['b']]]], [['Ink '], ['notebook']], []] as RichText[]) {
      const { repo } = open(at(15))
      oldNotebook(repo, title)
      expect(migrateNotebookTitle(repo)).toBe(false)
      expect(titleOf(repo)).toEqual(title)
    }
  })

  it('does nothing the second time', () => {
    const { clock, repo } = open(at(15))
    oldNotebook(repo, [['Ink notebook']])
    migrateNotebookTitle(repo)
    const first = repo.get(NOTEBOOK_ID) as Block
    clock.t = at(16)
    expect(migrateNotebookTitle(repo)).toBe(false)
    expect(repo.get(NOTEBOOK_ID)).toEqual(first)
  })

  it('touches nothing when there is no notebook, or another page holds its id', () => {
    const empty = open(at(15))
    expect(migrateNotebookTitle(empty.repo)).toBe(false)
    expect(empty.repo.get(NOTEBOOK_ID)).toBeNull()

    const other = open(at(15))
    other.repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { title: [['Ink notebook']] } })
    expect(migrateNotebookTitle(other.repo)).toBe(false)
    expect(titleOf(other.repo)).toEqual([['Ink notebook']])
  })

  it('is the name a new notebook starts with', () => {
    const { clock, repo } = open(at(15))
    new NotebookService({ repo, now: () => clock.t, systemLocale: () => 'en-US' }).ensure()
    expect(titleOf(repo)).toEqual([['Meditations']])
    expect(migrateNotebookTitle(repo)).toBe(false)
  })

  it('is the same on two devices, so sync merges it without a conflict', () => {
    // Both devices hold the notebook as an older build made it, synced once.
    const a = open(at(14))
    oldNotebook(a.repo, [['Ink notebook']])
    const base = workspaceFromRows(a.repo.syncRows(), a.repo.rootOrder())
    const b = open(at(14))
    b.repo.applySync({ put: [...base.blocks.values()] as Block[], remove: [], root: { order: base.root, at: base.rootAt ?? 0 }, snapshots: [], foreign: [], resetPages: [], settings: {} })
    expect(titleOf(b.repo)).toEqual([['Ink notebook']])

    // Each one is updated and started on its own, at a different time.
    a.clock.t = at(15, 9)
    b.clock.t = at(16, 20)
    migrateNotebookTitle(a.repo)
    migrateNotebookTitle(b.repo)
    const wsA = workspaceFromRows(a.repo.syncRows(), a.repo.rootOrder())
    const wsB = workspaceFromRows(b.repo.syncRows(), b.repo.rootOrder())
    const { result, conflicts } = mergeWorkspace(base, wsA, wsB)
    expect(checkWorkspace(result)).toEqual([])
    expect(conflicts).toEqual([])
    expect(result.blocks.get(NOTEBOOK_ID)?.props['title']).toEqual([['Meditations']])
  })
})
