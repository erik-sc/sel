import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MEETINGS_CHANNELS, type MeetingsStatus } from '../../shared/meetings'
import { isValidId } from '../db/blocks'
import type { Repository } from '../db/repository'
import { isAppUrl, isTrustedSender } from '../security'
import { recordingGrants } from './grant'
import type { MeetingsBridge } from './index'

/**
 * The `meetings:*` channels and the two places where the app's lifecycle meets a recording
 * (a window closing, the app quitting). This file is all of the feature that loads at
 * start-up; the service, the transcription engine and the downloader are imported when a
 * window first asks. Every invoke goes through `handle`, which checks the sender and reduces
 * failures to safe messages; every argument is validated by the service before it is used.
 */

type Handle = (channel: string, fn: (args: unknown[], event: IpcMainInvokeEvent) => unknown) => void

export interface MeetingsIpcContext {
  handle: Handle
  repo: Repository
  /** Broadcasts what a background step (a transcript written) changed in the database. */
  flushChanges(): void
}

export interface MeetingsHooks {
  /** True when closing `win` now would cut a recording short: the caller keeps it open and `askToStop` is shown. */
  holdsRecording(win: BrowserWindow): boolean
  /** Asks whether to stop and save; closes the window (or quits) afterwards when the answer is yes. */
  askToStop(win: BrowserWindow, then: 'close' | 'quit'): void
  /** The window that is recording, if any. */
  recordingWindow(): BrowserWindow | null
  /** Deletes old audio when `meetings.deleteAfterDays` says so. Loads nothing when there is nothing recorded. */
  prune(): void
}

const PRUNE_IDLE_MS = 30_000

export function registerMeetingsIpc({ handle, repo, flushChanges }: MeetingsIpcContext): MeetingsHooks {
  let bridge: MeetingsBridge | null = null
  const meetings = async (): Promise<MeetingsBridge> => (bridge ??= new (await import('./index')).MeetingsBridge(repo, flushChanges))
  const windowOf = (event: { sender: Electron.WebContents }): BrowserWindow | null => BrowserWindow.fromWebContents(event.sender)
  app.on('will-quit', () => void bridge?.dispose())

  // Every window asks this at start-up. Until something was recorded there is nothing to load:
  // the answer is known from one setting.
  handle('meetings:status', async () => {
    if (bridge || existsSync(join(app.getPath('userData'), 'recordings'))) return (await meetings()).service.status()
    const id = repo.getSetting('meetings.databaseId')
    const database = isValidId(id) ? repo.get(id) : null
    const idle: MeetingsStatus = {
      systemAudio: process.platform === 'win32',
      databaseId: database && database.type === 'database' && database.trashedAt === null ? database.id : null,
      recording: null,
      transcribing: null,
      interrupted: []
    }
    return idle
  })
  handle('meetings:create', async ([input]) => (await meetings()).service.create(input))

  // ---- the transcription engine
  handle('meetings:engine.status', async () => (await meetings()).engine.status())
  // Runs for as long as the download does; its progress goes to every window as events.
  handle('meetings:engine.download', async ([options]) => {
    const model = options !== null && typeof options === 'object' ? (options as { model?: unknown }).model : undefined
    return (await meetings()).engine.install(model)
  })
  handle('meetings:engine.cancelDownload', async () => (await meetings()).engine.cancelDownload())
  // Both go through a native dialog: the renderer never names a path to run or to load.
  handle('meetings:engine.pickProgram', async (_args, event) => (await meetings()).pickProgram(windowOf(event)))
  handle('meetings:engine.pickModel', async (_args, event) => (await meetings()).pickModel(windowOf(event)))
  handle('meetings:engine.remove', async () => (await meetings()).engine.remove())

  // ---- recording. `begin` and `probe` are the user gestures the permission handlers wait for.
  handle('meetings:recording.probe', async (_args, event) => {
    const m = await meetings()
    m.watch(event.sender)
    m.service.probe(event.sender.id)
  })
  handle('meetings:recording.begin', async ([pageId, options], event) => {
    const m = await meetings()
    m.watch(event.sender)
    return m.service.begin(event.sender.id, pageId, options)
  })
  handle('meetings:recording.pause', async ([token], event) => (await meetings()).service.pause(event.sender.id, token))
  handle('meetings:recording.resume', async ([token], event) => (await meetings()).service.resume(event.sender.id, token))
  handle('meetings:recording.stop', async ([token], event) => (await meetings()).service.stop(event.sender.id, token))
  handle('meetings:recording.recover', async ([pageId]) => (await meetings()).service.recover(pageId))
  handle('meetings:recording.discard', async ([pageId]) => (await meetings()).service.discard(pageId))

  // The binary channels: fire-and-forget, so nothing is thrown back. A message from anything
  // but the app's own top frame is dropped here; everything else is the frame gate's business.
  const binary = (channel: string, deliver: (m: MeetingsBridge, sender: number, args: unknown[]) => void): void => {
    ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
      // No bridge, no recording: there is nobody to deliver to.
      if (!bridge || !isTrustedSender(event)) return
      try {
        deliver(bridge, event.sender.id, args)
      } catch (err) {
        console.error(`[ipc] ${channel} failed`, err)
      }
    })
  }
  binary(MEETINGS_CHANNELS.frames, (m, sender, [token, seq, mic, system]) => m.service.frames(sender, token, seq, mic, system))
  binary(MEETINGS_CHANNELS.encoded, (m, sender, [token, stream, seq, bytes]) => m.service.encoded(sender, token, stream, seq, bytes))

  // ---- after the recording
  handle('meetings:transcribe', async ([pageId]) => (await meetings()).service.transcribe(pageId))
  handle('meetings:cancelTranscribe', async ([pageId]) => (await meetings()).service.cancelTranscribe(pageId))
  handle('meetings:setSpeakers', async ([pageId, speakers]) => (await meetings()).service.setSpeakers(pageId, speakers))
  handle('meetings:audio.info', async ([pageId]) => (await meetings()).service.info(pageId))
  handle('meetings:audio.delete', async ([pageId]) => (await meetings()).service.deleteAudio(pageId))
  handle('meetings:storage', async () => {
    const m = await meetings()
    const [recordings, engine] = await Promise.all([m.service.storage(), m.engine.storageBytes()])
    return { ...recordings, engineBytes: engine }
  })
  handle('meetings:openFolder', async () => (await meetings()).openFolder())

  const recordingWindow = (): BrowserWindow | null => {
    const owner = bridge?.service.recordingOwner
    if (owner === null || owner === undefined) return null
    return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.id === owner) ?? null
  }
  let asking = false

  return {
    holdsRecording: (win) => !win.isDestroyed() && bridge?.service.recordingOwner === win.webContents.id,
    recordingWindow,
    askToStop(win, then) {
      if (asking || win.isDestroyed()) return
      asking = true
      if (win.isMinimized()) win.restore()
      win.focus()
      void dialog
        .showMessageBox(win, {
          type: 'question',
          message: 'A meeting is being recorded.',
          detail: 'Stop the recording and save it before closing? What was recorded so far is kept either way.',
          buttons: ['Stop and save', 'Keep recording'],
          defaultId: 0,
          cancelId: 1
        })
        .then(async ({ response }) => {
          if (response !== 0) return
          await bridge?.service.stopNow()
          if (then === 'quit') app.quit()
          else if (!win.isDestroyed()) win.close()
        })
        .catch((err: unknown) => console.error('[meetings] could not stop the recording', err))
        .finally(() => (asking = false))
    },
    prune() {
      if (typeof repo.getSetting('meetings.deleteAfterDays') !== 'number') return
      setTimeout(() => {
        void meetings()
          .then((m) => m.service.prune())
          .catch((err: unknown) => console.error('[meetings] old audio could not be deleted', err))
      }, PRUNE_IDLE_MS).unref()
    }
  }
}

/**
 * The session's answer to `getDisplayMedia`: what the computer plays (and a screen, which the
 * page drops at once: Chromium only hands out loopback audio together with a video source).
 * Given only to the app's own top frame, only inside the window of a grant that asked for the
 * computer's audio, once. Everything else gets nothing.
 */
export function handleDisplayMedia(ses: Session): void {
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const deny = (): void => {
      try {
        callback({})
      } catch {
        /* an empty answer is a refusal; some versions say so by throwing */
      }
    }
    try {
      const frame = request.frame
      const contents = frame ? webContents.fromFrame(frame) : undefined
      // The top frame of a window of the app, showing the app, asking for audio.
      const top = !!frame && !!contents && !contents.isDestroyed() && contents.mainFrame.processId === frame.processId && contents.mainFrame.routingId === frame.routingId
      const trusted = top && !!frame && isAppUrl(frame.url) && isAppUrl(contents.getURL()) && request.audioRequested
      if (!contents || process.platform !== 'win32' || !recordingGrants.takeSystem(contents.id, trusted)) return deny()
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(
        (sources) => (sources[0] ? callback({ video: sources[0], audio: 'loopback' }) : deny()),
        deny
      )
    } catch {
      deny()
    }
  })
}
