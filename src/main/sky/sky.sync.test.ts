/**
 * The Sky across devices, through real git: each device writes its own happenings (a pomodoro, a
 * checked to-do, a name) under `sel-sky`, and sync makes the union. Skipped, with a message, on a
 * computer without git (see ../sync/harness.ts).
 */
import { expect, it } from 'vitest'
import { pomodoroEventId, SKY_ID } from '../../shared/sky'
import { NotebookService } from '../notebook/service'
import { bareRemote, device, sync, suite, type Device } from '../sync/harness'
import { SkyService } from './service'

const at = (date: number, hour: number): number => new Date(2026, 9, date, hour).getTime()
const skyOf = (d: Device): SkyService => new SkyService({ repo: d.repo, now: () => d.clock.t, systemLocale: () => 'en-US' })
const notebookOf = (d: Device): NotebookService => new NotebookService({ repo: d.repo, now: () => d.clock.t, systemLocale: () => 'en-US' })

suite('sync with real git: the sky', () => {
  it('brings two skies started apart together, as the union of what each wrote', async () => {
    const remote = bareRemote()
    const a = device('Desk', at(15, 9))
    const b = device('Laptop', at(15, 10))
    expect((await a.setup(remote)).lastError).toBeUndefined()
    expect((await b.setup(remote)).lastError).toBeUndefined()

    // Both start the sky before either has heard of the other's.
    notebookOf(a).write('2026-10-15', 'the desk')
    skyOf(a).recordPomodoro({ at: at(15, 9), minutes: 25 })
    skyOf(b).recordPomodoro({ at: at(15, 10), minutes: 25 })
    skyOf(b).name('2026-09', 'The move')
    await sync(a, b, a)

    for (const d of [a, b]) {
      expect(d.repo.listRoot().filter((p) => p.id === SKY_ID)).toHaveLength(1)
      const view = skyOf(d).view()
      expect(view.pomodoros.map((p) => p.key).sort()).toEqual([pomodoroEventId(at(15, 9)), pomodoroEventId(at(15, 10))].sort())
      expect(view.names).toEqual({ '2026-09': 'The move' })
      expect(view.meditations).toEqual([{ day: '2026-10-15', text: 'the desk' }])
    }

    // A name written again later on the desk wins on both.
    a.clock.t = at(16, 8)
    skyOf(a).name('2026-09', 'The long move')
    await sync(a, b)
    expect(skyOf(b).view().names).toEqual({ '2026-09': 'The long move' })
  })
})
