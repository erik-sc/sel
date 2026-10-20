import type { WebContents } from 'electron'
import type { HermanLocale } from '../../shared/herman'
import type { Repository } from '../db/repository'
import type { Handlers } from '../invoke'
import type { HermanDay } from './service'
import type { HermanBridge } from './index'
import { defineFeature, type Registered } from '../feature'

/**
 * The `herman:*` channels. This file is all of Herman that loads at start-up; his lines, the
 * counsel and the scheduler are imported when a window first asks. Every handler is registered
 * by ../ipc.ts behind its wrapper, which checks the sender and reduces failures to safe messages,
 * and every argument is validated by the service before it is used.
 */

export interface HermanIpcContext {
  repo: Repository
  /** Today's tasks and agenda, from what the briefing has stored. */
  day: () => Promise<HermanDay>
  /** True while something is being recorded. */
  recording: () => boolean
}

export interface HermanHooks {
  /** A task was marked done from `sender` (the Today screen), or that was taken back. */
  taskCompleted(sender: WebContents): void
  taskUncompleted(): void
  /** The Sky played a moment in `sender`; `line` says it in his language. */
  sky(sender: WebContents, line: (locale: HermanLocale) => string): void
}

export function registerHermanIpc({ repo, day, recording }: HermanIpcContext): HermanHooks & { handlers: Handlers<'herman'> } {
  let bridge: HermanBridge | null = null
  const herman = async (): Promise<HermanBridge> => (bridge ??= new (await import('./index')).HermanBridge(repo, day, recording))

  return {
    handlers: {
      'herman:state': async () => (await herman()).service.state(),
      'herman:nudge.next': async ([signals], event) => (await herman()).next(signals, event.sender),
      'herman:nudge.dismiss': async ([id, feedback]) => (await herman()).service.dismiss(id, feedback),
      'herman:met': async () => (await herman()).service.met(),
      'herman:reset': async () => (await herman()).service.reset()
    },
    taskCompleted(sender) {
      // Nothing of him is loaded for this unless a window has already asked for him.
      if (bridge) void bridge.completed(sender)
    },
    taskUncompleted() {
      bridge?.service.uncompleted()
    },
    sky(sender, line) {
      // Like a streak: nothing of him is loaded for this unless a window has already asked for him.
      bridge?.sky(sender, line)
    }
  }
}

/**
 * Herman: his settings, and what he says unasked, composed in this process from the day's tasks and
 * agenda as stored: no model is called for it, and nothing is fetched.
 */
export const hermanFeature = defineFeature({
  namespace: 'herman',
  register: (ctx): HermanHooks & Registered<'herman'> =>
    registerHermanIpc({
      repo: ctx.repo,
      day: async () => {
        const { tasks, events } = await ctx.feature('briefing').stored()
        return { tasks: { overdue: tasks.overdue, today: tasks.today }, events: events.today }
      },
      recording: () => ctx.recording()
    })
})
