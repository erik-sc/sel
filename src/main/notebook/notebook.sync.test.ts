/**
 * The ink notebook across devices, through real git: each device starts the notebook on its own
 * and writes its days, and sync brings them together, a day that has ended on the receiving
 * device included. Skipped, with a message, on a computer without git (see ../sync/harness.ts).
 */
import { expect, it } from 'vitest'
import { entryId, NOTEBOOK_ID } from '../../shared/notebook'
import { bareRemote, device, sync, suite, type Device } from '../sync/harness'
import { NotebookService } from './service'

const at = (date: number, hour: number): number => new Date(2026, 9, date, hour).getTime()
const notebookOf = (d: Device): NotebookService => new NotebookService({ repo: d.repo, now: () => d.clock.t, systemLocale: () => 'en-US' })

suite('sync with real git: the ink notebook', () => {
  it('merges two notebooks started apart, and brings a day that has ended here', async () => {
    const remote = bareRemote()
    const a = device('Desk', at(15, 9))
    const b = device('Laptop', at(15, 10))
    expect((await a.setup(remote)).lastError).toBeUndefined()
    expect((await b.setup(remote)).lastError).toBeUndefined()

    // Both start the notebook before either has heard of the other's.
    notebookOf(a).write('2026-10-15', 'the desk, in the morning')
    notebookOf(b).ensure()
    await sync(a, b, a)
    expect(a.repo.listRoot().filter((p) => p.id === NOTEBOOK_ID)).toHaveLength(1)
    expect(b.repo.listRoot().filter((p) => p.id === NOTEBOOK_ID)).toHaveLength(1)
    expect(
      notebookOf(b)
        .get()
        .entries.map((e) => e.text)
    ).toEqual(['the desk, in the morning'])

    // The laptop rewrites the 15th late that evening; the desk is already in the 16th.
    b.clock.t = at(15, 23)
    notebookOf(b).write('2026-10-15', 'the laptop, at night')
    a.clock.t = at(16, 8)
    notebookOf(a).write('2026-10-16', 'the desk, the next day')
    await sync(b, a, b)
    for (const d of [a, b]) {
      expect(
        notebookOf(d)
          .get()
          .entries.map((e) => [e.day, e.text])
      ).toEqual([
        ['2026-10-16', 'the desk, the next day'],
        ['2026-10-15', 'the laptop, at night']
      ])
      expect(d.repo.get(NOTEBOOK_ID)?.content.sort()).toEqual([entryId('2026-10-15'), entryId('2026-10-16')])
    }
    // On the desk the 15th is ink again.
    expect(() => notebookOf(a).write('2026-10-15', 'changed')).toThrow(/has ended/)
  })
})
