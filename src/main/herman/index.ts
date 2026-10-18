import { app, BrowserWindow, type WebContents } from 'electron'
import { HERMAN_NUDGE_CHANNEL, type HermanLocale, type HermanNudgeReply } from '../../shared/herman'
import type { Repository } from '../db/repository'
import { devFastMode, HermanService, type HermanDay } from './service'

/**
 * Herman wired to the app: the settings store, the system's language and the windows. Loaded
 * the first time a window asks for him (see ./register.ts), not at start-up. He starts nothing
 * by himself: no timer runs here, no model is called, nothing is fetched.
 */

export class HermanBridge {
  readonly service: HermanService
  private readonly fast: boolean

  constructor(
    repo: Repository,
    day: () => Promise<HermanDay>,
    private readonly recording: () => boolean
  ) {
    const fast = devFastMode(process.env['SEL_HERMAN_FAST'], app.isPackaged)
    this.fast = fast !== null
    this.service = new HermanService({
      getSetting: (key) => repo.getSetting(key),
      setSetting: (key, value) => repo.setSetting(key, value),
      day,
      pageExists: (id) => {
        const block = repo.get(id)
        // An archived page was put away on purpose: he does not suggest going back to it.
        return !!block && block.trashedAt === null && (block.type === 'page' || block.type === 'database') && !repo.archivedAmong([id]).has(id)
      },
      systemLocale: () => app.getLocale(),
      fast
    })
  }

  /** What this process knows about the moment by itself: a recording, a window that is full screen or not in front. */
  private busy(sender: WebContents): boolean {
    const win = BrowserWindow.fromWebContents(sender)
    if (this.recording() || !win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return true
    // An automated check drives a window that is not in front; everywhere else he waits until it is.
    return !this.fast && !win.isFocused()
  }

  next(signals: unknown, sender: WebContents): Promise<HermanNudgeReply> {
    return this.service.next(signals, this.busy(sender))
  }

  /** The Sky played a moment he may remark on: said in `sender`, when he may speak at all. */
  sky(sender: WebContents, line: (locale: HermanLocale) => string): void {
    try {
      const nudge = this.service.sky(line, this.busy(sender))
      if (nudge && !sender.isDestroyed()) sender.send(HERMAN_NUDGE_CHANNEL, nudge)
    } catch (err) {
      console.error('[herman] could not remark on the sky', err)
    }
  }

  /** A task was ticked in `sender`: when that makes a streak, he says so there and nowhere else. */
  async completed(sender: WebContents): Promise<void> {
    try {
      const nudge = await this.service.completed(this.busy(sender))
      if (nudge && !sender.isDestroyed()) sender.send(HERMAN_NUDGE_CHANNEL, nudge)
    } catch (err) {
      console.error('[herman] could not remark on a streak', err)
    }
  }
}
