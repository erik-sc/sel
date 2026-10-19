import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, shell, webContents, type WebContents } from 'electron'
import { MEETINGS_CHANNELS, type EngineStatus, type MeetingsProgress, type MeetingsStatus } from '../../shared/meetings'
import { devLoopback } from '../briefing/net'
import type { Repository } from '../db/repository'
import { recordingGrants } from './grant'
import { MeetingsService } from './service'
import { WhisperEngine } from './whisper/engine'
import type { PinnedSet } from './whisper/pinned'

/**
 * Meetings wired to the app: the profile directory, the windows and the native dialogs.
 * Loaded the first time a window asks for anything of it (see ./register.ts), not at start-up.
 */

/** Where recordings live. Fixed: no window ever names a path. */
export function recordingsDir(): string {
  return join(app.getPath('userData'), 'recordings')
}

/**
 * Stand-ins for development and automated checks of the UI, read by unpackaged builds only: a
 * shipped app never takes the program to run, or what to download, from the environment.
 *   SEL_WHISPER_CLI   a program (or a .mjs script) to run instead of whisper-cli
 *   SEL_WHISPER_PINS  a JSON file that replaces the pinned downloads (a local stub server)
 */
export function devWhisper(env: NodeJS.ProcessEnv, isPackaged: boolean): { program: string | null; pins: PinnedSet | null } {
  if (isPackaged) return { program: null, pins: null }
  let pins: PinnedSet | null = null
  const file = env['SEL_WHISPER_PINS']
  if (file) {
    try {
      pins = JSON.parse(readFileSync(file, 'utf8')) as PinnedSet
    } catch (err) {
      console.error('[meetings] SEL_WHISPER_PINS could not be read', err)
    }
  }
  return { program: env['SEL_WHISPER_CLI'] || null, pins }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export class MeetingsBridge {
  readonly service: MeetingsService
  readonly engine: WhisperEngine
  private readonly watched = new WeakSet<WebContents>()

  constructor(repo: Repository, flushChanges: () => void) {
    const dev = devWhisper(process.env, app.isPackaged)
    this.engine = new WhisperEngine({
      dir: join(app.getPath('userData'), 'whisper'),
      getSetting: (key) => repo.getSetting(key),
      setSetting: (key, value) => repo.setSetting(key, value),
      devProgram: dev.program,
      ...(dev.pins ? { pins: dev.pins, policy: { allowLoopbackHttp: devLoopback('1', app.isPackaged) } } : {}),
      onDownload: (state, outcome) => {
        const progress: MeetingsProgress = state
          ? { kind: 'download', ...state }
          : { kind: 'download-done', ok: outcome?.ok === true, ...(outcome?.message ? { message: outcome.message } : {}) }
        broadcast(MEETINGS_CHANNELS.progress, progress)
      }
    })
    this.service = new MeetingsService({
      repo,
      dir: recordingsDir(),
      engine: this.engine,
      grants: recordingGrants,
      // Chromium hands out what the computer plays ("loopback") on Windows; elsewhere it cannot.
      systemAudio: process.platform === 'win32',
      emitStatus: (status: MeetingsStatus) => broadcast(MEETINGS_CHANNELS.status, status),
      emitProgress: (progress) => broadcast(MEETINGS_CHANNELS.progress, progress),
      sendStop: (owner, pageId) => {
        const contents = webContents.fromId(owner)
        if (contents && !contents.isDestroyed()) contents.send(MEETINGS_CHANNELS.stop, pageId)
      },
      flushChanges
    })
  }

  /** A window that is given a grant is watched: when it goes away, so does what it was allowed. */
  watch(sender: WebContents): void {
    if (this.watched.has(sender)) return
    this.watched.add(sender)
    const owner = sender.id
    const gone = (): void =>
      void this.service.ownerGone(owner).catch((err: unknown) => console.error('[meetings] could not finish a recording', err))
    sender.once('destroyed', gone)
    sender.on('render-process-gone', gone)
    sender.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) gone()
    })
  }

  /** The only way a program to run enters the settings: a native file dialog, then a check that it is whisper-cli. */
  async pickProgram(win: BrowserWindow | null): Promise<EngineStatus | null> {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the whisper program (whisper-cli)',
      buttonLabel: 'Choose',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }] : undefined
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    if (result.canceled || !file) return null
    const kept = await this.engine.useProgram(file)
    const status = await this.engine.status()
    return kept ? status : { ...status, error: 'That file does not answer like whisper-cli, so it was not kept.' }
  }

  async pickModel(win: BrowserWindow | null): Promise<EngineStatus | null> {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a whisper model file (ggml-….bin)',
      buttonLabel: 'Choose',
      properties: ['openFile'],
      filters: [{ name: 'Whisper models', extensions: ['bin'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const file = result.filePaths[0]
    if (result.canceled || !file) return null
    const kept = await this.engine.useModel(file)
    const status = await this.engine.status()
    return kept ? status : { ...status, error: 'That file is not a model, so it was not kept.' }
  }

  /** Shows the recordings folder in the file manager. The path is fixed here. */
  async openFolder(): Promise<void> {
    const dir = recordingsDir()
    await mkdir(dir, { recursive: true })
    shell.showItemInFolder(dir)
  }

  async dispose(): Promise<void> {
    this.engine.cancelDownload()
    await this.service.dispose()
  }
}
