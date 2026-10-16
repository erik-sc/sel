import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, Menu, Notification, powerMonitor, Tray, type NativeImage } from 'electron'
import { ALARMS_CHANNEL, type Announcement } from '../../shared/alarms'
import type { Briefing, BriefingEvent } from '../../shared/briefing'
import type { BriefingPromptData } from '../ai/prompts'
import type { AiService } from '../ai/service'
import type { Repository } from '../db/repository'
import { hermanLocale } from '../herman/service'
import { tasksDatabase } from './reminders'
import { AlarmsService } from './service'
import { isQuickAddUrl } from './windows'

/**
 * The alarms wired to the app: the settings store, the windows, the system's notifications and
 * power events, and the notification-area icon that keeps sel running when the user wants the
 * alarms to ring with every window closed. Started with the app (see ./register.ts): an alarm
 * is the one thing in sel that happens at a time the user chose rather than when they act.
 */

/** The command-line flag sel is started with by the system at login: no window, just the icon. */
export const HIDDEN_FLAG = '--sel-hidden'

export interface AlarmsContext {
  repo: Repository
  briefing(): Promise<Briefing>
  promptData(): Promise<BriefingPromptData>
  /** The stored events of the calendars in a span; a calendar that is due is read in the background. */
  calendar(from: number, to: number): Promise<BriefingEvent[]>
  ai(): Promise<{ service: AiService }>
  recording(): boolean
  createWindow(): void
}

export class AlarmsBridge {
  readonly service: AlarmsService
  private tray: Tray | null = null
  private icon: NativeImage | null = null

  constructor(private readonly ctx: AlarmsContext) {
    const { repo } = ctx
    this.service = new AlarmsService({
      getSetting: (key) => repo.getSetting(key),
      setSetting: (key, value) => repo.setSetting(key, value),
      now: () => Date.now(),
      id: () => randomUUID(),
      timers: {
        set: (run, ms) => setTimeout(run, ms).unref(),
        clear: (handle) => clearTimeout(handle as NodeJS.Timeout)
      },
      briefing: ctx.briefing,
      tasks: () => {
        const database = tasksDatabase(repo.listRoot())
        return database ? { database, rows: repo.children(database.id) } : null
      },
      calendar: ctx.calendar,
      locale: () => hermanLocale(repo.getSetting('ai.language'), app.getLocale()),
      recording: ctx.recording,
      deliver: (announcement) => this.deliver(announcement),
      writeBriefing: (signal) => this.writeBriefing(signal),
      log: (message, err) => console.error(`[alarms] ${message}`, err ?? '')
    })
    // A computer that slept past a time, or whose clock moved, looks again.
    powerMonitor.on('resume', () => this.service.plan())
    powerMonitor.on('unlock-screen', () => this.service.plan())
    app.on('will-quit', () => this.service.stop())
    this.service.plan()
    void this.applySystem()
  }

  /** The settings changed: look at the clock again, and at the icon and the login item. */
  settingChanged(): void {
    this.service.plan()
    void this.applySystem()
  }

  /** Whether sel stays running (in the notification area) when its last window closes. */
  keepRunning(): boolean {
    return this.service.settings().tray
  }

  // ---- telling the user ----

  /** The window that speaks: the one in front, else the last one; a new one when none is open. */
  private deliver(announcement: Announcement): void {
    const windows = appWindows()
    const focused = BrowserWindow.getFocusedWindow()
    const win = focused && windows.includes(focused) ? focused : windows[windows.length - 1]
    if (!win) {
      // The new window asks for what is pending once it has loaded (alarms.pending).
      this.ctx.createWindow()
      return
    }
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.showInactive()
    if (!win.isFocused()) {
      win.flashFrame(true)
      this.notify(announcement, win)
    }
    win.webContents.send(ALARMS_CHANNEL, announcement)
  }

  private notify(announcement: Announcement, win: BrowserWindow): void {
    if (!Notification.isSupported()) return
    const title = announcement.title ?? 'Herman'
    const body = announcement.text.length > 240 ? `${announcement.text.slice(0, 239)}…` : announcement.text
    // The chime is the window's; the system's own sound would ring twice.
    const notification = new Notification({ title, body, silent: true })
    notification.on('click', () => {
      if (win.isDestroyed()) return this.ctx.createWindow()
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    notification.show()
  }

  // ---- the AI briefing ----

  private async writeBriefing(signal: AbortSignal): Promise<string> {
    const [{ service }, { buildBriefingPrompt }] = await Promise.all([this.ctx.ai(), import('../ai/prompts')])
    const data = await this.ctx.promptData()
    if (signal.aborted) throw new Error('aborted')
    return new Promise((resolve, reject) => {
      let text = ''
      const id = service.run(
        { action: 'custom' },
        {
          delta: (chunk) => {
            text += chunk
          },
          done: () => resolve(text),
          error: (failure) => reject(new Error(failure.message))
        },
        null,
        (language, voice) => buildBriefingPrompt(data, { defaultLanguage: language, voice })
      )
      signal.addEventListener('abort', () => {
        service.cancel(id)
        reject(new Error('aborted'))
      })
    })
  }

  // ---- the notification area and the login item ----

  private async applySystem(): Promise<void> {
    const settings = this.service.settings()
    try {
      if (settings.tray && !this.tray) await this.showTray()
      else if (!settings.tray && this.tray) {
        this.tray.destroy()
        this.tray = null
      }
    } catch (err) {
      console.error('[alarms] could not show the icon', err)
    }
    // Only the installed app registers itself: a development build would register Electron.
    if (!app.isPackaged || process.platform === 'linux') return
    try {
      const want = settings.openAtLogin
      if (app.getLoginItemSettings({ args: [HIDDEN_FLAG] }).openAtLogin !== want) app.setLoginItemSettings({ openAtLogin: want, args: [HIDDEN_FLAG] })
    } catch (err) {
      console.error('[alarms] could not change the login item', err)
    }
  }

  private async showTray(): Promise<void> {
    this.icon ??= await app.getFileIcon(process.execPath, { size: 'small' })
    if (this.tray || !this.service.settings().tray) return
    const portuguese = hermanLocale(this.ctx.repo.getSetting('ai.language'), app.getLocale()) === 'pt-BR'
    const tray = new Tray(this.icon)
    tray.setToolTip('sel')
    const open = (): void => {
      const win = appWindows()[0]
      if (!win) return this.ctx.createWindow()
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    tray.on('click', open)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: portuguese ? 'Abrir o sel' : 'Open sel', click: open },
        { label: portuguese ? 'Briefing agora' : 'Brief me now', click: () => void this.service.test() },
        { type: 'separator' },
        { label: portuguese ? 'Sair' : 'Quit', click: () => app.quit() }
      ])
    )
    this.tray = tray
  }
}

/** The windows that show the workspace, in the order they were opened (not the quick-add window: ./windows.ts). */
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed() && !isQuickAddUrl(win.webContents.getURL()))
}

