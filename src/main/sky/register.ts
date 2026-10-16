import { app, BrowserWindow, type WebContents } from 'electron'
import type { PomodoroCompleted } from '../../shared/pomodoro'
import { isSkyMoment, SKY_CHANGED_CHANNEL } from '../../shared/sky'
import { isQuickAddUrl } from '../alarms/windows'
import type { Repository } from '../db/repository'
import { SKY_LINES } from '../herman/lines'
import type { HermanLocale } from '../../shared/herman'
import type { Handlers } from '../invoke'
import { SkyService, skyLineMoment } from './service'

/**
 * The `sky:*` channels, and the two happenings the Sky writes as they happen: a to-do checked on
 * a page (the repository says so after it commits) and a focus phase of the pomodoro that ran to
 * its end. They are written whether or not the Sky is turned on, so it is right when it comes back.
 */

export interface SkyContext {
  repo: Repository
  /** `pomodoro:completed` in this process (./pomodoro/register.ts). */
  onPomodoroCompleted(listener: (event: PomodoroCompleted) => void): () => void
  /** What was written outside an invoke reaches the windows (and sync) from here. */
  flushChanges(): void
  /** Herman, when a window has already asked for him. */
  herman(sender: WebContents, line: (locale: HermanLocale) => string): void
}

export function registerSkyIpc(ctx: SkyContext): { handlers: Handlers<'sky'> } {
  const service = new SkyService({ repo: ctx.repo, systemLocale: () => app.getLocale() })

  const changed = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed() || isQuickAddUrl(win.webContents.getURL())) continue
      win.webContents.send(SKY_CHANGED_CHANNEL)
    }
  }

  // Inside an invoke (an edit, an apply): the handler drains the changes; the windows hear it.
  ctx.repo.onTodoChecked((id) => {
    try {
      if (service.recordTodo(id)) changed()
    } catch (err) {
      console.error('[sky] a checked to-do could not be written', err)
    }
  })

  // From the pomodoro's own timer, outside any invoke.
  ctx.onPomodoroCompleted((event) => {
    try {
      if (service.recordPomodoro(event)) {
        ctx.flushChanges()
        changed()
      }
    } catch (err) {
      console.error('[sky] a pomodoro could not be written', err)
    }
  })

  return {
    handlers: {
      'sky:view': () => service.view(),
      'sky:name': ([month, text]) => service.name(month, text),
      'sky:moment': ([moment], event) => {
        if (!isSkyMoment(moment)) throw new Error('Invalid moment')
        const facts = service.moment(moment)
        if (!facts || !skyLineMoment(facts, 'en')) return
        ctx.herman(event.sender, (locale) => {
          const said = skyLineMoment(facts, locale)
          return said ? SKY_LINES[locale](said) : ''
        })
      }
    }
  }
}
