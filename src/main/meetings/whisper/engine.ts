import { randomBytes } from 'node:crypto'
import { readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isWhisperModel, MEETINGS_DEFAULTS, WHISPER_MODELS, type EngineDownload, type EngineStatus, type WhisperModelId } from '../../../shared/meetings'
import type { NetPolicy, Resolver } from '../../briefing/net'
import { DownloadError, downloadVerified } from './download'
import { DOWNLOAD_HOSTS, PINNED, PROGRAM_NAME, type PinnedSet } from './pinned'
import { probeWhisper, type WhisperProgram } from './run'
import { extractZip, ZipError } from './zip'

/**
 * Where the transcription program and its model are, and how they get there. Free of
 * Electron imports (unit-tested); the file dialogs live in ../index.ts.
 *
 *   <dir>/<version>/whisper-cli(.exe) + the libraries beside it   Selida's own copy
 *   <dir>/models/ggml-<name>.bin                                   models Selida downloaded
 *
 * A program the user chose (`meetings.whisperPath`) comes before Selida's copy, and a model
 * file they chose (`meetings.modelPath`) before a downloaded one. Both settings only ever get
 * a value from a native file dialog.
 */

export interface EngineOptions {
  /** `<userData>/whisper`. */
  dir: string
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  /** `<platform>-<arch>`; decides which archive, if any, can be downloaded. */
  platformKey?: string
  programName?: string
  pins?: PinnedSet
  hosts?: ReadonlySet<string>
  policy?: NetPolicy
  resolve?: Resolver
  /** A JavaScript stand-in for the program; pass it in unpackaged builds only. */
  devProgram?: string | null
  onDownload?(state: EngineDownload | null, outcome?: { ok: boolean; message?: string }): void
  freeBytes?(dir: string): Promise<number>
}

export interface EngineLocation {
  program: WhisperProgram
  model: string
}

async function isFile(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

export class WhisperEngine {
  private readonly pins: PinnedSet
  private readonly platformKey: string
  private readonly programName: string
  private download: { state: EngineDownload; abort: AbortController; done: Promise<void> } | null = null
  private lastError: string | undefined

  constructor(private readonly options: EngineOptions) {
    this.pins = options.pins ?? PINNED
    this.platformKey = options.platformKey ?? `${process.platform}-${process.arch}`
    this.programName = options.programName ?? PROGRAM_NAME
  }

  private text(key: string): string | null {
    let value: unknown = null
    try {
      value = this.options.getSetting(key)
    } catch {
      /* unreadable: as if unset */
    }
    return typeof value === 'string' && value ? value : null
  }

  get managedDir(): string {
    return join(this.options.dir, this.pins.version)
  }

  get modelsDir(): string {
    return join(this.options.dir, 'models')
  }

  private wantedModel(): WhisperModelId {
    const value = this.text('meetings.model')
    return isWhisperModel(value) ? value : MEETINGS_DEFAULTS.model
  }

  private async findProgram(): Promise<EngineStatus['program'] & { kind: WhisperProgram['kind'] } | null> {
    const dev = this.options.devProgram
    if (dev && (await isFile(dev)) !== null) return { path: dev, managed: false, version: 'development stand-in', kind: /\.(m|c)?js$/i.test(dev) ? 'node-script' : 'exe' }
    const chosen = this.text('meetings.whisperPath')
    if (chosen && (await isFile(chosen)) !== null) return { path: chosen, managed: false, version: this.text('meetings.whisperVersion') ?? 'unknown', kind: 'exe' }
    const own = join(this.managedDir, this.programName)
    if ((await isFile(own)) !== null) return { path: own, managed: true, version: this.pins.version, kind: 'exe' }
    return null
  }

  private async findModel(): Promise<EngineStatus['model'] | null> {
    const chosen = this.text('meetings.modelPath')
    if (chosen) {
      const bytes = await isFile(chosen)
      if (bytes !== null) return { path: chosen, managed: false, id: null, bytes }
    }
    const wanted = this.wantedModel()
    // The model asked for, or failing that any model that is here.
    for (const id of [wanted, ...WHISPER_MODELS.filter((other) => other !== wanted)]) {
      const path = join(this.modelsDir, this.pins.models[id].file)
      const bytes = await isFile(path)
      if (bytes !== null) return { path, managed: true, id, bytes }
    }
    return null
  }

  async status(): Promise<EngineStatus> {
    const [program, model] = await Promise.all([this.findProgram(), this.findModel()])
    const canDownload = this.pins.programs[this.platformKey] !== undefined
    const status: EngineStatus = {
      state: !program ? (canDownload || this.text('meetings.whisperPath') ? 'missing-program' : 'unsupported') : !model ? 'missing-model' : 'ready',
      canDownload,
      offer: {
        version: this.pins.version,
        programBytes: this.pins.programs[this.platformKey]?.size ?? 0,
        models: Object.fromEntries(WHISPER_MODELS.map((id) => [id, this.pins.models[id].size])) as Record<WhisperModelId, number>
      },
      download: this.download ? { ...this.download.state } : null
    }
    // Where there is nothing to download, a missing program is still something the user can fix by choosing one.
    if (!program && !canDownload) status.state = 'unsupported'
    if (program) status.program = { path: program.path, managed: program.managed, version: program.version }
    if (model) status.model = model
    if (this.lastError) status.error = this.lastError
    return status
  }

  /** What a transcription runs with, or null when something is missing. */
  async locate(): Promise<EngineLocation | null> {
    const [program, model] = await Promise.all([this.findProgram(), this.findModel()])
    return program && model ? { program: { kind: program.kind, path: program.path }, model: model.path } : null
  }

  private progress(phase: EngineDownload['phase'], received: number, total: number): void {
    if (!this.download) return
    this.download.state = { phase, received, total }
    this.options.onDownload?.({ ...this.download.state })
  }

  /**
   * Downloads the program (when Selida has none) and the model `id`, each verified against
   * its pinned digest before it is put in place. One download at a time; resolves when it is
   * over, with the status afterwards. Never rejects: what went wrong is in `error`.
   */
  async install(rawModel: unknown): Promise<EngineStatus> {
    if (!isWhisperModel(rawModel)) throw new Error('Unknown model')
    if (this.download) throw new Error('A download is already running.')
    const abort = new AbortController()
    this.lastError = undefined
    const common = { hosts: this.options.hosts ?? DOWNLOAD_HOSTS, policy: this.options.policy, resolve: this.options.resolve, signal: abort.signal, freeBytes: this.options.freeBytes }
    const work = async (): Promise<void> => {
      const archiveSpec = this.pins.programs[this.platformKey]
      if ((await isFile(join(this.managedDir, this.programName))) === null) {
        if (!archiveSpec) throw new Error('Selida cannot download the program for this system. Choose one instead.')
        const archive = join(this.options.dir, `program-${this.pins.version}.zip`)
        // An archive left by a run that ended between download and unpacking is not trusted: it is fetched and verified again.
        await rm(archive, { force: true })
        await downloadVerified(archiveSpec, archive, { ...common, onProgress: (received, total) => this.progress('program', received, total) })
        this.progress('unpacking', archiveSpec.size, archiveSpec.size)
        try {
          await this.unpack(archive)
        } finally {
          // Kept or not, the archive has done its part: a failed unpacking starts from a new download.
          await rm(archive, { force: true })
        }
      }
      const modelSpec = this.pins.models[rawModel]
      const target = join(this.modelsDir, modelSpec.file)
      if ((await isFile(target)) === null) {
        let last = 0
        await downloadVerified(modelSpec, target, {
          ...common,
          onProgress: (received, total) => {
            // The last megabytes are followed by reading the whole file again for its checksum.
            const phase = received >= total ? 'verifying' : 'model'
            if (received - last < 512 * 1024 && phase === 'model') return
            last = received
            this.progress(phase, received, total)
          }
        })
      }
      this.options.setSetting('meetings.model', rawModel)
    }
    const done = work().then(
      () => {
        this.download = null
        this.options.onDownload?.(null, { ok: true })
      },
      (err: unknown) => {
        this.download = null
        const cancelled = err instanceof DownloadError && err.reason === 'cancelled'
        const message = err instanceof DownloadError || err instanceof ZipError || (err instanceof Error && !('code' in err)) ? err.message.slice(0, 300) : 'The download failed.'
        if (!cancelled) {
          this.lastError = message
          if (!(err instanceof DownloadError) && !(err instanceof ZipError)) console.error('[meetings] the engine could not be installed', err)
        }
        this.options.onDownload?.(null, { ok: false, message: cancelled ? undefined : message })
      }
    )
    this.download = { state: { phase: 'program', received: 0, total: 0 }, abort, done }
    await done
    return this.status()
  }

  /** Keeps the program and the libraries that sit beside it in the archive; nothing else is written. */
  private async unpack(archive: string): Promise<void> {
    const bytes = await readFile(archive)
    const target = this.managedDir
    const staging = `${target}.tmp-${randomBytes(4).toString('hex')}`
    const program = this.programName.toLowerCase()
    let programDir: string | null = null
    try {
      const written = await extractZip(bytes, staging, (entry) => {
        const name = basename(entry.name)
        const lower = name.toLowerCase()
        if (lower === program) {
          programDir = dirname(entry.name)
          return name
        }
        return null
      })
      if (!written.length || programDir === null) throw new ZipError('the program is not in it')
      const beside = programDir
      // A second pass for the libraries of that same folder (the program's folder is known now).
      await extractZip(bytes, staging, (entry) => {
        const name = basename(entry.name)
        return dirname(entry.name) === beside && /\.(dll|so|dylib)$/i.test(name) ? name : null
      })
      await rm(target, { recursive: true, force: true })
      await rename(staging, target)
    } catch (err) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw err
    }
  }

  cancelDownload(): void {
    this.download?.abort.abort()
  }

  /** Deletes Selida's copy of the program and its models, and forgets the chosen paths. */
  async remove(): Promise<EngineStatus> {
    this.download?.abort.abort()
    await this.download?.done
    await rm(this.options.dir, { recursive: true, force: true })
    for (const key of ['meetings.whisperPath', 'meetings.whisperVersion', 'meetings.modelPath']) this.options.setSetting(key, null)
    this.lastError = undefined
    return this.status()
  }

  /**
   * Keeps a program the user picked in a file dialog, when it answers `--help` the way
   * whisper-cli does. Returns false (and keeps nothing) otherwise.
   */
  async useProgram(file: string): Promise<boolean> {
    if ((await isFile(file)) === null) return false
    const program: WhisperProgram = { kind: 'exe', path: file }
    const help = await probeWhisper(program, '--help', dirname(file))
    if (!help.ran || !/--output-json/.test(help.output)) return false
    const version = await probeWhisper(program, '--version', dirname(file))
    const match = version.code === 0 ? /version:?\s*v?(\d+\.\d+(?:\.\d+)?)/i.exec(version.output) : null
    this.options.setSetting('meetings.whisperPath', file)
    this.options.setSetting('meetings.whisperVersion', match ? match[1] : 'unknown')
    return true
  }

  /** Keeps a model file the user picked: a regular file that starts like a ggml model. */
  async useModel(file: string): Promise<boolean> {
    const bytes = await isFile(file)
    if (bytes === null || bytes < 1024 * 1024) return false
    this.options.setSetting('meetings.modelPath', file)
    return true
  }

  /** Bytes the downloaded program and models take. */
  async storageBytes(): Promise<number> {
    let total = 0
    const walk = async (dir: string, depth: number): Promise<void> => {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        return
      }
      for (const name of names) {
        const info = await stat(join(dir, name)).catch(() => null)
        if (info?.isFile()) total += info.size
        else if (info?.isDirectory() && depth < 3) await walk(join(dir, name), depth + 1)
      }
    }
    await walk(this.options.dir, 0)
    return total
  }
}
