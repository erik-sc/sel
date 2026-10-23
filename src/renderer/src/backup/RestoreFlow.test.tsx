// @vitest-environment happy-dom
// The guided restore sheet: choosing a backup shows what differs, one page is restored with the
// choice of its sub-pages, and restoring everything happens only after the confirm step in the
// sheet. window.api is a fake that records what was asked.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackupComparison, BackupEntry } from '@shared/data'
import { cleanup, render, seriousViolations, settle } from '@/a11y/testing'

vi.mock('@/store/tabs', () => ({ openPage: vi.fn() }))
vi.mock('@/store/blocks', () => ({ loadTree: () => Promise.resolve() }))
vi.mock('@/store/tree', () => ({ refreshTree: () => Promise.resolve() }))

const BACKUPS: BackupEntry[] = [
  { at: new Date(2026, 9, 20, 9, 12).getTime(), size: 4_000_000, kind: 'auto', name: 'sel-2026-10-20-091200.db' }
]

const COMPARISON: BackupComparison = {
  source: 'sel-2026-10-20-091200.db',
  at: BACKUPS[0].at,
  pages: 3,
  counts: { 'only-backup': 1, changed: 1, 'only-now': 1, same: 1 },
  differences: [
    { id: 'gone', title: 'Plan', icon: null, kind: 'page', path: ['Projects'], change: 'only-backup', subpages: 2 },
    { id: 'edited', title: 'Notes', icon: null, kind: 'page', path: [], change: 'changed', subpages: 0 },
    { id: 'fresh', title: 'Fresh', icon: null, kind: 'page', path: [], change: 'only-now', subpages: 0 }
  ]
}

let calls: unknown[][]

beforeEach(() => {
  calls = []
  ;(window as unknown as { api: unknown }).api = {
    app: { getSetting: () => Promise.resolve(null) },
    data: {
      compare: (source: string) => {
        calls.push(['compare', source])
        return Promise.resolve({ outcome: 'compared', comparison: COMPARISON })
      },
      pickFile: () => Promise.resolve({ outcome: 'cancelled' }),
      restorePage: (source: string, pageId: string, withSubpages: boolean) => {
        calls.push(['restorePage', source, pageId, withSubpages])
        return Promise.resolve({ outcome: 'restored', pageId, title: 'Plan', pages: 3, notes: [] })
      },
      restoreAll: (source: string) => {
        calls.push(['restoreAll', source])
        return Promise.resolve({ outcome: 'restarting' })
      }
    }
  }
})

afterEach(cleanup)

const buttonNamed = (name: string | RegExp): HTMLButtonElement => {
  const found = [...document.querySelectorAll('button')].find((b) =>
    typeof name === 'string' ? b.textContent?.trim() === name : name.test(b.textContent ?? '')
  )
  if (!found) throw new Error(`No button ${String(name)}`)
  return found
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => target.click())
  await settle()
}

async function openOnComparison(): Promise<void> {
  const { RestoreSheet } = await import('./RestoreFlow')
  await render(<RestoreSheet open onClose={() => undefined} backups={BACKUPS} />)
  await settle()
  await click(document.querySelector<HTMLButtonElement>('.restore-backup') as HTMLButtonElement)
}

describe('the guided restore', () => {
  it('shows what differs from now, by kind of change, with whole counts', async () => {
    await openOnComparison()
    expect(calls).toEqual([['compare', 'sel-2026-10-20-091200.db']])
    const titles = [...document.querySelectorAll('.restore-group-title')].map((h) => h.textContent)
    expect(titles).toEqual(['Deleted since (1)', 'Changed since (1)', 'New since (1)'])
    // A page made since has nothing to restore.
    const fresh = [...document.querySelectorAll('.restore-page')].find((li) => li.textContent?.includes('Fresh')) as HTMLElement
    expect(fresh.querySelector('button')).toBeNull()
    expect(await seriousViolations()).toEqual([])
  })

  it('restores one page, with the pages below it when asked', async () => {
    await openOnComparison()
    await click(buttonNamed('Restore…'))
    const box = document.querySelector<HTMLInputElement>('.restore-check input') as HTMLInputElement
    expect(box.closest('label')?.textContent).toBe('With the 2 pages below it')
    await click(box)
    await click(buttonNamed('Restore this page'))
    // Then what differs is compared again, so that "Restore everything" says what is left.
    expect(calls.slice(-2)).toEqual([
      ['restorePage', 'sel-2026-10-20-091200.db', 'gone', true],
      ['compare', 'sel-2026-10-20-091200.db']
    ])
    expect(document.body.textContent).toContain('"Plan" is back as it was in the backup, with 2 more.')
  })

  it('restores everything only after the confirm step, and can be cancelled there', async () => {
    await openOnComparison()
    await click(buttonNamed('Restore everything…'))
    expect(calls.some((c) => c[0] === 'restoreAll')).toBe(false)
    expect(document.body.textContent).toContain(
      '1 page comes back, 1 page goes back to how it was, 1 page made since is not in it and will be gone.'
    )
    await click(buttonNamed('Cancel'))
    expect(document.querySelector('.restore-confirm')).toBeNull()
    await click(buttonNamed('Restore everything…'))
    await click(buttonNamed('Restore everything and restart'))
    expect(calls.at(-1)).toEqual(['restoreAll', 'sel-2026-10-20-091200.db'])
    expect(buttonNamed('Restarting…').disabled).toBe(true)
  })
})
