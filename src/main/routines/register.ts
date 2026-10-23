import { app, BrowserWindow, type WebContents } from 'electron'
import { privacyChecker } from '../../shared/aiPrivate'
import { anyRoutineOn, readRoutines, ROUTINES_KEY, ROUTINES_READY_CHANNEL } from '../../shared/routines'
import { TASKS_DATABASE_ID } from '../../shared/tasks'
import type { Repository } from '../db/repository'
import { defineFeature, type FeatureContext, type Registered } from '../feature'
import type { RoutinesService } from './service'

/**
 * The `routines:*` channels and the clock of the persona's routines (./service.ts). While no
 * routine is on, nothing of them is loaded and no timer runs but a look at the setting; with one
 * on, the clock is looked at every minute or so. A routine's AI request runs in this process
 * without any window (counted as `routine:<id>`, shared/aiUsage.ts); what it prepared waits here
 * until a window asks at a quiet moment (`routines:next`), and windows are told when something is
 * ready (`routines:ready`).
 */

const MINUTE = 60_000
/** The first look after the app starts: a missed routine of this morning may still be due. */
const FIRST_LOOK_MS = 30_000
/** Turns a routine may take with the tools (the morning plan reads the workspace and the user's servers). */
const ROUTINE_TURNS = 8
const DAY = 86_400_000

function routinesOn(repo: Repository): boolean {
  try {
    return anyRoutineOn(readRoutines(repo.getSetting(ROUTINES_KEY)))
  } catch {
    return false
  }
}

export function registerRoutines(ctx: FeatureContext): Registered<'routines'> {
  const repo = ctx.repo
  // Quick timings for development and automated checks of the UI; a shipped app keeps its restraint whatever the environment says.
  const fast = !app.isPackaged && process.env['SEL_ROUTINES_FAST'] === '1'
  let service: RoutinesService | null = null
  let timer: NodeJS.Timeout | null = null
  let stopped = false

  const load = async (): Promise<RoutinesService> => {
    if (service) return service
    const [{ RoutinesService }, data, { findStalled }, { hermanLocale }] = await Promise.all([
      import('./service'),
      import('./data'),
      import('./stalled'),
      import('../herman/service')
    ])
    const source = async () => {
      const briefing = await ctx.feature('briefing').stored()
      // What is private from the AI is left out of every list (shared/aiPrivate.ts).
      const hidden = privacyChecker({ get: (id) => repo.get(id) })
      return {
        briefing,
        tasksDatabase: repo.get(TASKS_DATABASE_ID) ?? null,
        taskRows: repo.children(TASKS_DATABASE_ID),
        hidden: (id: string) => hidden(id),
        now: Date.now()
      }
    }
    service ??= new RoutinesService({
      getSetting: (key) => repo.getSetting(key),
      setSetting: (key, value) => repo.setSetting(key, value),
      locale: () => hermanLocale(repo.getSetting('ai.language'), app.getLocale()),
      read: {
        day: async () => data.dayData(await source()),
        close: async () => {
          const { NotebookService } = await import('../notebook/service')
          const review = new NotebookService({ repo, systemLocale: () => app.getLocale() }).review()
          return data.closeData(await source(), review)
        },
        stalled: async (skip) => {
          const from = await source()
          const now = from.now
          const log = repo.activity.enabled() ? repo.activity.rows(now - 30 * DAY, now + 1) : []
          const found = findStalled(from.taskRows, log, now, { skip, hidden: from.hidden })
          return found ? data.stalledData(found, from) : null
        }
      },
      ask: async (routine, build, options) => {
        const bridge = await ctx.feature('ai').bridge()
        const origin = `routine:${routine}`
        // The local activity log keeps that a request was made and by whom: never its text.
        repo.activity.record({ kind: 'ai', area: origin })
        return new Promise((resolve, reject) => {
          bridge.service.runPrompt(
            (language, voice, tools, persona, servers) =>
              build({ language, voice, persona, tools, servers: servers ?? [], context: options.context }),
            {
              delta: () => undefined,
              done: (result) => resolve({ text: result.text, ...(result.sent ? { sent: result.sent } : {}) }),
              error: (failure) => reject(new Error(failure.message))
            },
            null,
            { origin, ...(options.tools ? { tools: { maxTurns: ROUTINE_TURNS, external: 'read' as const } } : {}) }
          )
        })
      },
      notify: () => {
        for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(ROUTINES_READY_CHANNEL)
      },
      fast
    })
    return service
  }

  /** What this process knows about the moment by itself: a recording, a window that is full screen, minimized or not in front. */
  const busy = (sender: WebContents): boolean => {
    const win = BrowserWindow.fromWebContents(sender)
    if (ctx.recording() || !win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return true
    // An automated check drives a window that is not in front; everywhere else it waits until it is.
    return !fast && !win.isFocused()
  }

  const arm = (delay: number): void => {
    if (timer) clearTimeout(timer)
    if (stopped) return
    timer = setTimeout(() => void look(), Math.max(1000, Math.min(delay, 30 * MINUTE)))
    timer.unref()
  }

  const look = async (): Promise<void> => {
    timer = null
    if (!routinesOn(repo)) return arm(30 * MINUTE)
    try {
      await ctx.ready
      arm(await (await load()).tick())
    } catch (err) {
      console.error('[routines] could not look at the clock', err)
      arm(5 * MINUTE)
    }
  }

  app.on('will-quit', () => {
    stopped = true
    if (timer) clearTimeout(timer)
  })

  return {
    handlers: {
      'routines:next': async ([signals], event) => (await load()).next(signals, busy(event.sender)),
      'routines:run': async ([id]) => (await load()).runNow(id),
      'routines:usage': async () => (await load()).usage()
    },
    onSettingChanged(key) {
      if (key !== ROUTINES_KEY) return
      service?.settingsChanged()
      // Turned on just now: a routine whose time has come runs soon, not in half an hour.
      arm(5000)
    },
    start() {
      arm(FIRST_LOOK_MS)
    }
  }
}

/** The persona's routines (épico C of 0.8.0): AI at a few moments of the day, held until the user looks. */
export const routinesFeature = defineFeature({
  namespace: 'routines',
  register: (ctx): Registered<'routines'> => registerRoutines(ctx)
})
