import { app, BrowserWindow, Notification, powerMonitor } from 'electron'
import { isAiLanguage } from '../../shared/ai'
import { POMODORO_CHANNELS, type PomodoroCompleted, type PomodoroEnded, type PomodoroSnapshot } from '../../shared/pomodoro'
import { isQuickAddUrl } from '../alarms/windows'
import type { Repository } from '../db/repository'
import type { Handlers } from '../invoke'
import { PomodoroService } from './service'

/**
 * The `pomodoro:*` channels and the one timer behind them (./service.ts), wired to the windows,
 * the system's notifications and its sleep. The notification is this module's own (the alarms
 * have theirs): silent, because the window that rings plays the sound.
 */

export interface PomodoroContext {
  repo: Repository
  /** A meeting is being recorded: nothing rings. */
  recording(): boolean
}

export interface PomodoroHooks {
  handlers: Handlers<'pomodoro'>
  /** A setting was written; the windows follow when it is one of the pomodoro's. */
  settingChanged(key: string): void
  /** `pomodoro:completed` in the main process: a focus phase ran to its end. Returns an unsubscribe function. */
  onCompleted(listener: (event: PomodoroCompleted) => void): () => void
}

export function registerPomodoroIpc(ctx: PomodoroContext): PomodoroHooks {
  const listeners = new Set<(event: PomodoroCompleted) => void>()
  const service = new PomodoroService({
    getSetting: (key) => ctx.repo.getSetting(key),
    setSetting: (key, value) => ctx.repo.setSetting(key, value),
    now: () => Date.now(),
    timers: {
      set: (run, ms) => setTimeout(run, ms).unref(),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout)
    },
    locale: () => localeOf(ctx.repo.getSetting('ai.language'), app.getLocale()),
    recording: ctx.recording,
    publish: (snapshot) => {
      for (const win of appWindows()) win.webContents.send(POMODORO_CHANNELS.changed, snapshot)
    },
    ended: (ended, snapshot) => ring(ended, snapshot),
    completed: (event) => {
      for (const win of appWindows()) win.webContents.send(POMODORO_CHANNELS.completed, event)
      for (const listener of listeners) {
        try {
          listener(event)
        } catch (err) {
          console.error('[pomodoro] a listener failed', err)
        }
      }
    }
  })
  // A computer that slept through the end of a phase says so when it wakes. Watched from the
  // first pomodoro on: until then there is nothing to end.
  let watching = false
  const watchSleep = (): void => {
    if (watching) return
    watching = true
    powerMonitor.on('resume', () => service.check())
    powerMonitor.on('unlock-screen', () => service.check())
  }
  app.on('will-quit', () => service.dispose())

  return {
    handlers: {
      'pomodoro:state': () => service.snapshot(),
      'pomodoro:start': () => {
        watchSleep()
        return service.start()
      },
      'pomodoro:pause': () => service.pause(),
      'pomodoro:resume': () => service.resume(),
      'pomodoro:skip': () => service.skip(),
      'pomodoro:next': () => service.next(),
      'pomodoro:stop': () => service.stop()
    },
    settingChanged(key) {
      if (key.startsWith('pomodoro.') || key === 'ai.language') service.settingChanged()
    },
    onCompleted(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/** The window in front rings; with none in front, the last one, and the system shows a notification. */
function ring(ended: PomodoroEnded, snapshot: PomodoroSnapshot): void {
  const windows = appWindows()
  const focused = BrowserWindow.getFocusedWindow()
  const front = focused && windows.includes(focused) ? focused : null
  const win = front ?? windows[windows.length - 1]
  if (win) win.webContents.send(POMODORO_CHANNELS.ended, ended)
  // Nothing at all while a meeting is recorded: the widget alone shows that the phase is over.
  if (front || !ended.sound) return
  if (win && !win.isDestroyed()) win.flashFrame(true)
  notify(ended, snapshot, win ?? null)
}

function notify(ended: PomodoroEnded, snapshot: PomodoroSnapshot, win: BrowserWindow | null): void {
  if (!Notification.isSupported()) return
  const { title, body } = notificationText(ended, snapshot)
  const notification = new Notification({ title, body, silent: true })
  notification.on('click', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  notification.show()
}

/** The words of the notification, in the language of the rest of the app's own voice. */
export function notificationText(ended: PomodoroEnded, snapshot: PomodoroSnapshot): { title: string; body: string } {
  const pt = snapshot.locale === 'pt-BR'
  const minutes = ended.next === 'short' ? snapshot.settings.short : ended.next === 'long' ? snapshot.settings.long : snapshot.settings.focus
  if (ended.phase === 'focus') {
    return {
      title: pt ? 'Fim do foco' : 'Focus done',
      body: pt ? `Pausa de ${minutes} min? Volte ao sel para começar.` : `A ${minutes} min break? Come back to sel to start it.`
    }
  }
  return {
    title: pt ? 'Fim da pausa' : 'Break over',
    body: pt ? 'Voltar ao foco? Volte ao sel para começar.' : 'Back to focus? Come back to sel to start.'
  }
}

/**
 * The language Herman speaks (main/herman/service.ts `hermanLocale`, written again here so that
 * his whole module is not loaded with the app for the sake of one line).
 */
function localeOf(aiLanguage: unknown, systemLocale: string): 'en' | 'pt-BR' {
  if (isAiLanguage(aiLanguage)) return aiLanguage === 'pt-BR' ? 'pt-BR' : 'en'
  return /^pt\b/i.test(systemLocale) ? 'pt-BR' : 'en'
}

/** The windows that show the workspace (not the quick-add window, which has no corner to show it in). */
function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && !win.webContents.isDestroyed() && !isQuickAddUrl(win.webContents.getURL()))
}
