import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  cleanMic,
  isMeetingLanguage,
  MEETING_LIMITS,
  MEETING_STREAMS,
  MEETINGS_DEFAULTS,
  MEETINGS_TITLE,
  PCM,
  TRANSCRIPT_TITLE,
  type ActiveRecording,
  type BeginResult,
  type InterruptedRecording,
  type MeetingAudioInfo,
  type MeetingAudioState,
  type MeetingEventContext,
  type MeetingsProgress,
  type MeetingsStatus,
  type MeetingStream,
  type MeetingTrack,
  type RecordingNotice
} from '../../shared/meetings'
import { plainText } from '../../shared/richtext'
import type { Block, BlockProps, DatabaseView, PropertySchema, PropertyValue } from '../../shared/types'
import { isValidId, type TreeInput } from '../db/blocks'
import type { Repository } from '../db/repository'
import * as arg from '../validate'
import { FrameGate } from './frames'
import type { GrantStore } from './grant'
import { recordingUrl } from './serve'
import { cleanSpeaker, DEFAULT_SPEAKERS, mergeTranscript, paragraphSpans, renameSpeakerSpans, type Paragraph, type Segment, type Speakers } from './transcript'
import { patchWebmDuration } from './webm'
import { peakOf, readWavInfo, repairWav, sliceWav, WavWriter } from './wav'
import type { WhisperEngine } from './whisper/engine'
import { runWhisper, WhisperError, whisperThreads, whisperTimeoutMs, type WhisperOutput, type WhisperRun } from './whisper/run'

/**
 * Meetings as the main process sees them: the "Meetings" database and its pages, the audio
 * files of a recording while it is made, and the path from those files to a transcript page.
 * Knows nothing of windows or ipc (unit-tested): the bridge in ./index.ts hands it validated
 * senders and gives it ways to speak.
 *
 * Files, all under `<userData>/recordings/<meeting page id>/` and never synced or exported:
 *   meeting.json            what this folder is: state, length, speakers
 *   mic.wav, system.wav     the two streams as recorded, kept separate (who spoke is known)
 *   mic.webm, system.webm   the same, compressed, for listening later
 *   transcript.json         the transcript as data
 *   chunks/                 pieces of a transcription in progress, so that it can continue
 */

type ManifestState = 'recording' | 'recorded' | 'ready' | 'failed'

interface Manifest {
  v: 1
  pageId: string
  state: ManifestState
  startedAt: number
  endedAt?: number
  seconds: number
  mic: boolean
  system: boolean
  speakers: Speakers
  /** The language the first piece was heard in; the rest is transcribed as that. */
  language?: string
  transcriptPageId?: string
  error?: string
}

const SCHEMA_IDS = { date: 'date', duration: 'duration', status: 'status', attendees: 'attendees' } as const
type StatusOption = 'recording' | 'transcribing' | 'ready'

export interface MeetingsServiceOptions {
  repo: Repository
  /** `<userData>/recordings`. */
  dir: string
  engine: WhisperEngine
  grants: GrantStore
  /** True where the computer's audio can be captured. */
  systemAudio: boolean
  emitStatus(status: MeetingsStatus): void
  emitProgress(progress: MeetingsProgress): void
  /** Tells the window that records to let go of the microphone. */
  sendStop(owner: number, pageId: string): void
  /** Pages changed outside an ipc call (a transcript was written): tell the windows. */
  flushChanges(): void
  freeBytes?(dir: string): Promise<number>
  now?(): number
  /** Seconds of audio handed to the program at a time. */
  chunkSeconds?: number
  diskCheckMs?: number
  /** Tests: replaces the program run. */
  runWhisper?(run: WhisperRun): Promise<WhisperOutput>
}

interface Live {
  pageId: string
  owner: number
  token: string
  dir: string
  gate: FrameGate
  writers: Partial<Record<MeetingStream, WavWriter>>
  encoded: Partial<Record<MeetingStream, number>>
  state: 'recording' | 'paused'
  manifest: Manifest
  /** Milliseconds of audio at which something was last heard. */
  lastLoudMs: number
  silent: boolean
  diskTimer: NodeJS.Timeout | null
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const info = await statfs(dir)
  return Number(info.bavail) * Number(info.bsize)
}

async function sizeOf(path: string): Promise<number> {
  return stat(path).then(
    (info) => (info.isFile() ? info.size : 0),
    () => 0
  )
}

function localDay(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function clock(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function line(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : undefined
}

/** A `create` input from a renderer, checked: a title and, from Today, the event it is for. */
export function meetingInput(value: unknown): { title?: string; event?: MeetingEventContext } {
  if (value === undefined || value === null) return {}
  const raw = arg.plainObject(value, 'meeting')
  const out: { title?: string; event?: MeetingEventContext } = {}
  const title = line(raw['title'], MEETING_LIMITS.title)
  if (title) out.title = title
  if (raw['event'] !== undefined && raw['event'] !== null) {
    const event = arg.plainObject(raw['event'], 'event')
    const { start, end } = event
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid event')
    const context: MeetingEventContext = { title: line(event['title'], MEETING_LIMITS.title) ?? '', start, end }
    const location = line(event['location'], 300)
    const description = typeof event['description'] === 'string' ? event['description'].slice(0, 2000).trim() : ''
    if (location) context.location = location
    if (description) context.description = description
    if (typeof event['uid'] === 'string' && event['uid'].length > 0 && event['uid'].length <= 400) context.uid = event['uid']
    out.event = context
  }
  return out
}

export class MeetingsService {
  private readonly repo: Repository
  private readonly dir: string
  private readonly now: () => number
  private live: Live | null = null
  private job: { pageId: string; abort: AbortController; percent: number; done: Promise<void> } | null = null
  private interrupted: InterruptedRecording[] | null = null
  private disposed = false

  constructor(private readonly options: MeetingsServiceOptions) {
    this.repo = options.repo
    this.dir = options.dir
    this.now = options.now ?? Date.now
  }

  // ---- small helpers ----------------------------------------------------------

  private folder(pageId: string): string {
    if (!isValidId(pageId)) throw new Error('Invalid pageId')
    return join(this.dir, pageId)
  }

  private setting<T>(key: string, fallback: T, ok: (value: unknown) => boolean): T {
    let value: unknown = null
    try {
      value = this.repo.getSetting(key)
    } catch {
      /* unreadable: the default */
    }
    return ok(value) ? (value as T) : fallback
  }

  private async readManifest(pageId: string): Promise<Manifest | null> {
    try {
      const data = JSON.parse(await readFile(join(this.folder(pageId), 'meeting.json'), 'utf8')) as Partial<Manifest> | null
      if (!data || data.v !== 1 || data.pageId !== pageId || typeof data.seconds !== 'number' || typeof data.startedAt !== 'number') return null
      if (data.state !== 'recording' && data.state !== 'recorded' && data.state !== 'ready' && data.state !== 'failed') return null
      return {
        v: 1,
        pageId,
        state: data.state,
        startedAt: data.startedAt,
        ...(typeof data.endedAt === 'number' ? { endedAt: data.endedAt } : {}),
        seconds: Math.max(0, data.seconds),
        mic: data.mic !== false,
        system: data.system === true,
        speakers: { mic: cleanSpeaker(data.speakers?.mic, DEFAULT_SPEAKERS.mic), system: cleanSpeaker(data.speakers?.system, DEFAULT_SPEAKERS.system) },
        ...(typeof data.language === 'string' && /^[a-z]{2,3}$/.test(data.language) ? { language: data.language } : {}),
        ...(isValidId(data.transcriptPageId) ? { transcriptPageId: data.transcriptPageId } : {}),
        ...(typeof data.error === 'string' ? { error: data.error.slice(0, 300) } : {})
      }
    } catch {
      return null
    }
  }

  private async writeManifest(manifest: Manifest): Promise<void> {
    await writeFile(join(this.folder(manifest.pageId), 'meeting.json'), JSON.stringify(manifest, null, 2), 'utf8')
  }

  // ---- the database -----------------------------------------------------------

  private database(): Block | null {
    const id = this.setting<string | null>('meetings.databaseId', null, isValidId)
    const block = id ? this.repo.get(id) : null
    return block && block.type === 'database' && block.trashedAt === null && typeof block.props.sourceId !== 'string' ? block : null
  }

  /** The "Meetings" database, created the first time a meeting is. */
  ensureDatabase(): Block {
    const current = this.database()
    if (current) return current
    const named = this.repo.listDatabases().find((database) => database.parentId === null && plainText(database.props.title).trim().toLowerCase() === MEETINGS_TITLE.toLowerCase())
    if (named) {
      this.repo.setSetting('meetings.databaseId', named.id)
      return named
    }
    const schema: Record<string, PropertySchema> = {
      title: { id: 'title', name: 'Title', type: 'title' },
      [SCHEMA_IDS.date]: { id: SCHEMA_IDS.date, name: 'Date', type: 'date' },
      [SCHEMA_IDS.duration]: { id: SCHEMA_IDS.duration, name: 'Duration', type: 'number' },
      [SCHEMA_IDS.status]: {
        id: SCHEMA_IDS.status,
        name: 'Status',
        type: 'select',
        options: [
          { id: 'recording', name: 'Recording', color: 'red' },
          { id: 'transcribing', name: 'Transcribing', color: 'yellow' },
          { id: 'ready', name: 'Ready', color: 'green' }
        ]
      },
      [SCHEMA_IDS.attendees]: { id: SCHEMA_IDS.attendees, name: 'Attendees', type: 'text' }
    }
    const order = ['title', SCHEMA_IDS.date, SCHEMA_IDS.duration, SCHEMA_IDS.status, SCHEMA_IDS.attendees]
    const views: DatabaseView[] = [{ id: randomUUID(), name: 'Table', type: 'table', visibleProperties: order, filters: [], sorts: [{ propertyId: SCHEMA_IDS.date, direction: 'desc' }] }]
    const created = this.repo.create({ type: 'database', parentId: null, props: { title: [[MEETINGS_TITLE]], icon: '\u{1F399}️', schema, views } })
    this.repo.setSetting('meetings.databaseId', created.id)
    return created
  }

  /** Writes the row's Status and Duration, where the database still has those properties. */
  private setRow(pageId: string, patch: { status?: StatusOption | null; minutes?: number }): void {
    try {
      const page = this.repo.get(pageId)
      const parent = page?.parentId ? this.repo.get(page.parentId) : null
      const schema = parent?.type === 'database' ? parent.props.schema : undefined
      if (!page || !schema) return
      const values: Record<string, PropertyValue> = { ...(page.props.values ?? {}) }
      const status = schema[SCHEMA_IDS.status]
      if (patch.status !== undefined && status?.type === 'select') {
        if (patch.status === null) delete values[SCHEMA_IDS.status]
        else if (status.options?.some((option) => option.id === patch.status)) values[SCHEMA_IDS.status] = patch.status
      }
      if (patch.minutes !== undefined && schema[SCHEMA_IDS.duration]?.type === 'number') values[SCHEMA_IDS.duration] = patch.minutes
      this.repo.update(pageId, { props: { values } as BlockProps })
    } catch (err) {
      console.error('[meetings] the meeting row could not be updated', err)
    }
  }

  /** The page of the Meetings database made for this occurrence of a calendar event, if one is there. */
  private pageForEvent(database: Block, uid: string, start: number): string | null {
    for (const row of this.repo.children(database.id)) {
      const made = row.props.meetingEvent
      if (row.type === 'page' && row.trashedAt === null && made && made.uid === uid && made.start === start) return row.id
    }
    return null
  }

  /**
   * A new page in the Meetings database. From Today or an event's alarm it carries the event's
   * title, day and time; when the event has a UID, a page already made for that occurrence is
   * the one returned.
   */
  create(rawInput: unknown): { pageId: string; existing?: boolean } {
    const input = meetingInput(rawInput)
    const database = this.ensureDatabase()
    const uid = input.event?.uid
    if (uid && input.event) {
      const found = this.pageForEvent(database, uid, input.event.start)
      if (found) return { pageId: found, existing: true }
    }
    const at = input.event?.start ?? this.now()
    const title = input.title ?? input.event?.title ?? `Meeting, ${new Date(at).toLocaleDateString('en', { day: 'numeric', month: 'long' })}`
    const values: Record<string, PropertyValue> = {}
    if (database.props.schema?.[SCHEMA_IDS.date]?.type === 'date') values[SCHEMA_IDS.date] = { start: localDay(at) }
    const children: TreeInput[] = []
    if (input.event) {
      const when = `${clock(input.event.start)}–${clock(input.event.end)}`
      children.push({ type: 'quote', props: { title: [[input.event.location ? `${when} · ${input.event.location}` : when]] } })
      if (input.event.description) children.push({ type: 'quote', props: { title: [[input.event.description.replace(/\s+/g, ' ').slice(0, 600)]] } })
    }
    children.push({ type: 'text', props: {} })
    const props: BlockProps = { title: [[title]], values }
    if (uid && input.event) props.meetingEvent = { uid, start: input.event.start }
    const page = this.repo.createTree({ type: 'page', props, children }, database.id)
    return { pageId: page.id }
  }

  // ---- status -----------------------------------------------------------------

  private active(): ActiveRecording | null {
    const live = this.live
    if (!live) return null
    return {
      pageId: live.pageId,
      state: live.state,
      elapsedMs: Math.round((live.gate.samplesWritten / PCM.sampleRate) * 1000),
      mic: live.manifest.mic,
      system: live.manifest.system,
      silent: live.silent
    }
  }

  /** Recordings a run of the app that ended badly left unfinished. Read once, then kept. */
  private async findInterrupted(): Promise<InterruptedRecording[]> {
    if (this.interrupted) return this.interrupted
    const found: InterruptedRecording[] = []
    let names: string[] = []
    try {
      names = await readdir(this.dir)
    } catch {
      /* no recordings yet */
    }
    for (const name of names) {
      if (!isValidId(name) || name === this.live?.pageId) continue
      const manifest = await this.readManifest(name)
      if (manifest?.state !== 'recording') continue
      const bytes = Math.max(await sizeOf(join(this.dir, name, 'mic.wav')), await sizeOf(join(this.dir, name, 'system.wav')))
      const page = this.repo.get(name)
      found.push({
        pageId: name,
        title: plainText(page?.props.title).trim() || 'Untitled',
        seconds: Math.max(0, Math.floor((bytes - 44) / PCM.bytesPerSample / PCM.sampleRate)),
        startedAt: manifest.startedAt
      })
    }
    this.interrupted = found
    return found
  }

  async status(notice?: { pageId: string; reason: RecordingNotice }): Promise<MeetingsStatus> {
    const status: MeetingsStatus = {
      systemAudio: this.options.systemAudio,
      databaseId: this.database()?.id ?? null,
      recording: this.active(),
      transcribing: this.job ? { pageId: this.job.pageId, percent: this.job.percent } : null,
      interrupted: await this.findInterrupted()
    }
    if (notice) status.notice = notice
    return status
  }

  private announce(notice?: { pageId: string; reason: RecordingNotice }): void {
    if (this.disposed) return
    void this.status(notice).then(
      (status) => this.options.emitStatus(status),
      (err: unknown) => console.error('[meetings] status failed', err)
    )
  }

  // ---- recording --------------------------------------------------------------

  get recordingOwner(): number | null {
    return this.live?.owner ?? null
  }

  /** A short grant to open the microphone once, so that the system tells the names of the devices. */
  probe(owner: number): void {
    if (this.live) return
    this.options.grants.issue(owner, { mic: true, system: false }, true)
  }

  async begin(owner: number, rawPageId: unknown, rawOptions: unknown): Promise<BeginResult> {
    const pageId = arg.id(rawPageId, 'pageId')
    const sources = arg.plainObject(arg.plainObject(rawOptions, 'options')['sources'], 'sources')
    if (sources['micId'] !== null && cleanMic({ id: sources['micId'], label: '' }) === undefined) throw new Error('Invalid microphone')
    if (typeof sources['system'] !== 'boolean') throw new Error('Invalid sources')
    if (this.live) throw new Error(this.live.pageId === pageId ? 'This meeting is already being recorded.' : 'Another meeting is being recorded. Stop it first.')
    const page = this.repo.get(pageId)
    if (!page || page.type !== 'page' || page.trashedAt !== null) throw new Error('The page no longer exists')
    const dir = this.folder(pageId)
    const existing = await this.readManifest(pageId)
    if (existing) throw new Error(existing.state === 'recording' ? 'This meeting has an unfinished recording. Recover or discard it first.' : 'This meeting already has a recording. Start a new meeting to record again.')
    await mkdir(this.dir, { recursive: true })
    const free = await (this.options.freeBytes ?? defaultFreeBytes)(this.dir)
    if (free < MEETING_LIMITS.minFreeBytes) throw new Error('There is not enough free disk space to record a meeting.')
    if (this.live) throw new Error('Another meeting is being recorded. Stop it first.')

    const system = sources['system'] && this.options.systemAudio
    const hours = this.setting<number>('meetings.maxHours', MEETING_LIMITS.maxHours.default, (value) => typeof value === 'number' && value >= MEETING_LIMITS.maxHours.min && value <= MEETING_LIMITS.maxHours.max)
    const manifest: Manifest = { v: 1, pageId, state: 'recording', startedAt: this.now(), seconds: 0, mic: true, system, speakers: { ...DEFAULT_SPEAKERS } }
    // Left over from a folder without a manifest (a crash between two steps): nothing worth keeping.
    await rm(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const writers: Live['writers'] = { mic: new WavWriter(join(dir, 'mic.wav')) }
    const encoded: Live['encoded'] = { mic: openSync(join(dir, 'mic.webm'), 'wx') }
    if (system) {
      writers.system = new WavWriter(join(dir, 'system.wav'))
      encoded.system = openSync(join(dir, 'system.webm'), 'wx')
    }
    await this.writeManifest(manifest)
    const grant = this.options.grants.issue(owner, { mic: true, system })
    const live: Live = {
      pageId,
      owner,
      token: grant.token,
      dir,
      gate: new FrameGate({ token: grant.token, owner, mic: true, system, maxSamples: Math.floor(hours * 3600 * PCM.sampleRate) }),
      writers,
      encoded,
      state: 'recording',
      manifest,
      lastLoudMs: 0,
      silent: false,
      diskTimer: null
    }
    live.diskTimer = setInterval(() => void this.checkDisk(live), this.options.diskCheckMs ?? 20_000)
    live.diskTimer.unref()
    this.live = live
    this.setRow(pageId, { status: 'recording' })
    this.options.flushChanges()
    this.announce()
    return { token: grant.token, system }
  }

  private async checkDisk(live: Live): Promise<void> {
    try {
      const free = await (this.options.freeBytes ?? defaultFreeBytes)(this.dir)
      if (this.live === live && free < MEETING_LIMITS.stopFreeBytes) await this.finalise(live, 'disk-low')
    } catch {
      /* a failed check is not a reason to stop */
    }
  }

  /** One message of the PCM channel. Never throws: what does not belong is dropped. */
  frames(sender: number, token: unknown, seq: unknown, mic: unknown, system: unknown): void {
    const live = this.live
    if (!live) return
    const verdict = live.gate.frames(sender, token, seq, mic, system)
    if (!verdict.ok) {
      if (verdict.fatal) void this.finalise(live, verdict.reason === 'full' ? 'max-duration' : 'failed')
      return
    }
    try {
      let peak = 0
      for (const stream of MEETING_STREAMS) {
        const samples = verdict[stream]
        if (!samples) continue
        live.writers[stream]?.append(samples)
        peak = Math.max(peak, peakOf(samples))
      }
      const elapsed = (live.gate.samplesWritten / PCM.sampleRate) * 1000
      if (peak >= MEETING_LIMITS.silencePeak) {
        live.lastLoudMs = elapsed
        if (live.silent) {
          live.silent = false
          this.announce()
        }
      } else if (!live.silent && elapsed - live.lastLoudMs >= MEETING_LIMITS.silenceMs) {
        live.silent = true
        this.announce()
      }
    } catch (err) {
      console.error('[meetings] the audio could not be written', err)
      void this.finalise(live, (err as NodeJS.ErrnoException).code === 'ENOSPC' ? 'disk-low' : 'failed')
    }
  }

  /** One chunk of the compressed copy. A chunk out of order ends that copy: the WAV is what counts. */
  encoded(sender: number, token: unknown, stream: unknown, seq: unknown, bytes: unknown): void {
    const live = this.live
    if (!live) return
    const verdict = live.gate.encoded(sender, token, stream, seq, bytes)
    if (verdict.ok) {
      const fd = live.encoded[verdict.stream]
      try {
        if (fd !== undefined) writeSync(fd, verdict.bytes)
      } catch {
        this.dropEncoded(live, verdict.stream)
      }
    } else if ((stream === 'mic' || stream === 'system') && (verdict.reason === 'bad-sequence' || verdict.reason === 'full' || verdict.reason === 'too-large')) {
      this.dropEncoded(live, stream)
    }
  }

  private dropEncoded(live: Live, stream: MeetingStream): void {
    const fd = live.encoded[stream]
    if (fd === undefined) return
    delete live.encoded[stream]
    try {
      closeSync(fd)
    } catch {
      /* already closed */
    }
    void rm(join(live.dir, `${stream}.webm`), { force: true }).catch(() => undefined)
  }

  private own(owner: number, token: unknown): Live {
    const live = this.live
    if (!live || live.owner !== owner || typeof token !== 'string' || token !== live.token) throw new Error('No recording is running.')
    return live
  }

  pause(owner: number, token: unknown): void {
    const live = this.own(owner, token)
    live.state = 'paused'
    this.announce()
  }

  resume(owner: number, token: unknown): void {
    const live = this.own(owner, token)
    live.state = 'recording'
    this.announce()
  }

  async stop(owner: number, token: unknown): Promise<MeetingAudioInfo> {
    const live = this.own(owner, token)
    await this.finalise(live, null)
    return this.info(live.pageId)
  }

  /** The window that records is gone (closed, reloaded, crashed): what it recorded is kept. */
  async ownerGone(owner: number): Promise<void> {
    this.options.grants.revoke(owner)
    if (this.live?.owner === owner) await this.finalise(this.live, 'interrupted')
  }

  /** Stops the recording from this side (the window is closing, the app is quitting). */
  async stopNow(): Promise<void> {
    if (this.live) await this.finalise(this.live, null, true)
  }

  /** Closes the files, writes their lengths and puts the meeting in its next state. */
  private async finalise(live: Live, notice: RecordingNotice | null, tellOwner = notice !== null): Promise<void> {
    if (this.live !== live) return
    this.live = null
    if (live.diskTimer) clearInterval(live.diskTimer)
    live.gate.close()
    this.options.grants.revoke(live.owner)
    let seconds = 0
    for (const stream of MEETING_STREAMS) {
      const writer = live.writers[stream]
      if (writer) {
        seconds = Math.max(seconds, writer.seconds)
        try {
          writer.close()
        } catch (err) {
          console.error('[meetings] a recording could not be closed', err)
        }
      }
      const fd = live.encoded[stream]
      if (fd !== undefined) {
        try {
          closeSync(fd)
        } catch {
          /* already closed */
        }
      }
    }
    if (tellOwner) this.options.sendStop(live.owner, live.pageId)
    try {
      if (seconds < 0.5) {
        // Nothing was recorded (the microphone could not be opened): as if it had never begun.
        await rm(live.dir, { recursive: true, force: true })
        this.setRow(live.pageId, { status: null })
      } else {
        for (const stream of MEETING_STREAMS) {
          if (live.encoded[stream] === undefined) continue
          const file = join(live.dir, `${stream}.webm`)
          if ((await sizeOf(file)) === 0) await rm(file, { force: true })
          else await patchWebmDuration(file, seconds)
        }
        live.manifest.state = 'recorded'
        live.manifest.seconds = seconds
        live.manifest.endedAt = this.now()
        await this.writeManifest(live.manifest)
        this.setRow(live.pageId, { status: null, minutes: Math.max(1, Math.round(seconds / 60)) })
      }
    } catch (err) {
      console.error('[meetings] the recording could not be finished', err)
    }
    this.options.flushChanges()
    this.announce(notice ? { pageId: live.pageId, reason: notice } : undefined)
  }

  /** Makes the files of a recording that was never stopped whole again. */
  async recover(rawPageId: unknown): Promise<MeetingAudioInfo> {
    const pageId = arg.id(rawPageId, 'pageId')
    const manifest = await this.readManifest(pageId)
    if (!manifest || manifest.state !== 'recording' || this.live?.pageId === pageId) throw new Error('There is nothing to recover for this meeting.')
    const dir = this.folder(pageId)
    let seconds = 0
    for (const stream of MEETING_STREAMS) seconds = Math.max(seconds, repairWav(join(dir, `${stream}.wav`))?.seconds ?? 0)
    this.interrupted = (this.interrupted ?? []).filter((entry) => entry.pageId !== pageId)
    if (seconds < 0.5) {
      await rm(dir, { recursive: true, force: true })
      this.setRow(pageId, { status: null })
    } else {
      for (const stream of MEETING_STREAMS) {
        const file = join(dir, `${stream}.webm`)
        if ((await sizeOf(file)) > 0) await patchWebmDuration(file, seconds)
        else await rm(file, { force: true })
      }
      await this.writeManifest({ ...manifest, state: 'recorded', seconds, endedAt: this.now() })
      this.setRow(pageId, { status: null, minutes: Math.max(1, Math.round(seconds / 60)) })
    }
    this.options.flushChanges()
    this.announce()
    return this.info(pageId)
  }

  async discard(rawPageId: unknown): Promise<void> {
    const pageId = arg.id(rawPageId, 'pageId')
    const manifest = await this.readManifest(pageId)
    if (!manifest || manifest.state !== 'recording' || this.live?.pageId === pageId) throw new Error('There is nothing to discard for this meeting.')
    await rm(this.folder(pageId), { recursive: true, force: true })
    this.interrupted = (this.interrupted ?? []).filter((entry) => entry.pageId !== pageId)
    this.setRow(pageId, { status: null })
    this.options.flushChanges()
    this.announce()
  }

  // ---- audio ------------------------------------------------------------------

  private async tracks(pageId: string, manifest: Manifest): Promise<MeetingTrack[]> {
    const dir = this.folder(pageId)
    const tracks: MeetingTrack[] = []
    for (const stream of MEETING_STREAMS) {
      if (!manifest[stream]) continue
      if ((await sizeOf(join(dir, `${stream}.webm`))) > 0) tracks.push({ stream, url: recordingUrl(pageId, stream, 'webm'), format: 'webm' })
      else if ((await sizeOf(join(dir, `${stream}.wav`))) > 44) tracks.push({ stream, url: recordingUrl(pageId, stream, 'wav'), format: 'wav' })
    }
    return tracks
  }

  private async folderBytes(dir: string): Promise<number> {
    let total = 0
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      return 0
    }
    for (const name of names) {
      if (name === 'chunks') total += await this.folderBytes(join(dir, name))
      else total += await sizeOf(join(dir, name))
    }
    return total
  }

  async info(rawPageId: unknown): Promise<MeetingAudioInfo> {
    const pageId = arg.id(rawPageId, 'pageId')
    const manifest = await this.readManifest(pageId)
    if (!manifest) return { state: 'none', seconds: 0, tracks: [], bytes: 0, transcriptPageId: null, speakers: { ...DEFAULT_SPEAKERS } }
    const live = this.live?.pageId === pageId
    let state: MeetingAudioState = manifest.state === 'recording' ? (live ? 'recording' : 'none') : manifest.state
    if (this.job?.pageId === pageId) state = 'transcribing'
    const transcript = manifest.transcriptPageId ? this.repo.get(manifest.transcriptPageId) : null
    const info: MeetingAudioInfo = {
      state,
      seconds: manifest.seconds,
      tracks: live || manifest.state === 'recording' ? [] : await this.tracks(pageId, manifest),
      bytes: await this.folderBytes(this.folder(pageId)),
      transcriptPageId: transcript && transcript.trashedAt === null ? transcript.id : null,
      speakers: manifest.speakers
    }
    if (manifest.error && state === 'failed') info.error = manifest.error
    return info
  }

  /** Deletes the audio of a meeting; the page, the transcript and what is known about it stay. */
  async deleteAudio(rawPageId: unknown): Promise<MeetingAudioInfo> {
    const pageId = arg.id(rawPageId, 'pageId')
    if (this.live?.pageId === pageId || this.job?.pageId === pageId) throw new Error('This meeting is being recorded or transcribed.')
    const manifest = await this.readManifest(pageId)
    if (!manifest) return this.info(pageId)
    const dir = this.folder(pageId)
    for (const name of ['mic.wav', 'system.wav', 'mic.webm', 'system.webm']) await rm(join(dir, name), { force: true })
    await rm(join(dir, 'chunks'), { recursive: true, force: true })
    // Without audio and without a transcript there is nothing left to keep a folder for.
    if (manifest.state !== 'ready') await rm(dir, { recursive: true, force: true })
    return this.info(pageId)
  }

  async storage(): Promise<{ bytes: number; meetings: number }> {
    let bytes = 0
    let meetings = 0
    let names: string[] = []
    try {
      names = await readdir(this.dir)
    } catch {
      /* nothing recorded yet */
    }
    for (const name of names) {
      if (!isValidId(name)) continue
      const size = await this.folderBytes(join(this.dir, name))
      bytes += size
      if (size > 0) meetings++
    }
    return { bytes, meetings }
  }

  /** `meetings.deleteAfterDays`: deletes the audio of meetings older than that. Returns how many. */
  async prune(): Promise<number> {
    const days = this.setting<number>('meetings.deleteAfterDays', MEETINGS_DEFAULTS.deleteAfterDays, (value) => typeof value === 'number' && value > 0)
    if (!days) return 0
    const before = this.now() - days * 24 * 3600 * 1000
    let pruned = 0
    let names: string[] = []
    try {
      names = await readdir(this.dir)
    } catch {
      return 0
    }
    for (const name of names) {
      if (!isValidId(name) || this.live?.pageId === name || this.job?.pageId === name) continue
      const manifest = await this.readManifest(name)
      if (!manifest || manifest.state === 'recording' || (manifest.endedAt ?? manifest.startedAt) > before) continue
      if ((await this.tracks(name, manifest)).length === 0) continue
      await this.deleteAudio(name)
      pruned++
    }
    return pruned
  }

  // ---- transcription ----------------------------------------------------------

  /**
   * Starts transcribing a recorded meeting and returns at once; progress and the end arrive
   * as events. One meeting at a time: the program takes most of the processor.
   */
  async transcribe(rawPageId: unknown): Promise<void> {
    const pageId = arg.id(rawPageId, 'pageId')
    if (this.job) throw new Error(this.job.pageId === pageId ? 'This meeting is already being transcribed.' : 'Another meeting is being transcribed. Wait for it to finish.')
    if (this.live?.pageId === pageId) throw new Error('This meeting is still being recorded.')
    const manifest = await this.readManifest(pageId)
    if (!manifest || manifest.state === 'recording') throw new Error('This meeting has no recording.')
    const located = await this.options.engine.locate()
    if (!located) throw new Error('Transcription is not set up yet.')
    const dir = this.folder(pageId)
    const streams: MeetingStream[] = []
    for (const stream of MEETING_STREAMS) if (manifest[stream] && (await readWavInfo(join(dir, `${stream}.wav`)))) streams.push(stream)
    if (!streams.length) throw new Error('The original audio of this meeting is no longer here, so it cannot be transcribed again.')
    if (this.job) throw new Error('Another meeting is being transcribed. Wait for it to finish.')

    const abort = new AbortController()
    const job = { pageId, abort, percent: 0, done: Promise.resolve() }
    this.job = job
    this.setRow(pageId, { status: 'transcribing' })
    this.options.flushChanges()
    this.announce()
    job.done = this.work(manifest, streams, located, job).then(
      () => undefined,
      async (err: unknown) => {
        const cancelled = err instanceof WhisperError && err.reason === 'cancelled'
        if (!cancelled) {
          const message = err instanceof WhisperError ? `${err.message}${err.detail ? ` (${err.detail})` : ''}` : err instanceof Error && !('code' in err) ? err.message : 'Transcription failed.'
          if (!(err instanceof WhisperError)) console.error('[meetings] transcription failed', err)
          await this.writeManifest({ ...manifest, state: 'failed', error: message.slice(0, 300) }).catch(() => undefined)
        }
        this.setRow(pageId, { status: null })
      }
    )
    void job.done.finally(() => {
      if (this.job === job) this.job = null
      this.options.flushChanges()
      this.announce()
    })
  }

  async cancelTranscribe(rawPageId: unknown): Promise<void> {
    const pageId = arg.id(rawPageId, 'pageId')
    if (this.job?.pageId !== pageId) return
    this.job.abort.abort()
    await this.job.done
  }

  private async work(manifest: Manifest, streams: MeetingStream[], located: { program: WhisperRun['program']; model: string }, job: { pageId: string; abort: AbortController; percent: number }): Promise<void> {
    const { pageId } = manifest
    const dir = this.folder(pageId)
    const chunks = join(dir, 'chunks')
    await mkdir(chunks, { recursive: true })
    const chunkSeconds = this.options.chunkSeconds ?? 600
    const run = this.options.runWhisper ?? runWhisper
    const threads = whisperThreads()
    const wanted = this.setting<string>('meetings.language', MEETINGS_DEFAULTS.language, isMeetingLanguage)
    let language = wanted === 'auto' ? (manifest.language ?? 'auto') : wanted

    // The plan first: how many pieces there are decides what a percent is.
    const plan: { stream: MeetingStream; index: number; from: number }[] = []
    for (const stream of streams) {
      const seconds = (await readWavInfo(join(dir, `${stream}.wav`)))?.seconds ?? 0
      for (let index = 0; index * chunkSeconds < seconds; index++) plan.push({ stream, index, from: index * chunkSeconds })
    }
    const report = (done: number, part: number): void => {
      const percent = plan.length ? Math.min(99, Math.floor(((done + part / 100) / plan.length) * 100)) : 99
      if (percent === job.percent) return
      job.percent = percent
      this.options.emitProgress({ kind: 'transcribe', pageId, percent })
    }

    const segments: Record<MeetingStream, Segment[]> = { mic: [], system: [] }
    for (const [position, piece] of plan.entries()) {
      if (job.abort.signal.aborted) throw new WhisperError('cancelled')
      const base = join(chunks, `${piece.stream}.${String(piece.index).padStart(4, '0')}`)
      const resultFile = `${base}.done.json`
      let result: Segment[] | null = null
      try {
        // A piece an earlier try finished is not transcribed again.
        const saved = JSON.parse(await readFile(resultFile, 'utf8')) as { language?: unknown; segments?: unknown }
        if (Array.isArray(saved.segments)) result = saved.segments as Segment[]
      } catch {
        /* not done yet */
      }
      if (!result) {
        const wav = `${base}.wav`
        const seconds = await sliceWav(join(dir, `${piece.stream}.wav`), wav, piece.from, chunkSeconds)
        try {
          // Silence is not sent to the program at all: it has nothing to find there and tends to invent.
          const quiet = peakOf(await readFile(wav).then((bytes) => bytes.subarray(44))) < MEETING_LIMITS.silencePeak
          if (quiet) result = []
          else {
            const output = await run({
              program: located.program,
              args: { model: located.model, input: wav, outputBase: base, language, threads },
              cwd: dir,
              timeoutMs: whisperTimeoutMs(seconds),
              signal: job.abort.signal,
              onProgress: (percent) => report(position, percent)
            })
            if (language === 'auto' && output.language) {
              language = output.language
              manifest.language = output.language
            }
            result = output.segments.map((segment) => ({ start: segment.start + piece.from, end: segment.end + piece.from, text: segment.text }))
          }
        } finally {
          await rm(wav, { force: true }).catch(() => undefined)
        }
        await writeFile(resultFile, JSON.stringify({ segments: result }), 'utf8')
      }
      segments[piece.stream].push(...result)
      report(position + 1, 0)
    }

    const paragraphs = mergeTranscript(segments.mic, segments.system)
    await writeFile(join(dir, 'transcript.json'), JSON.stringify({ language: manifest.language ?? null, paragraphs }), 'utf8')
    manifest.transcriptPageId = this.writeTranscriptPage(pageId, manifest, paragraphs)
    manifest.state = 'ready'
    delete manifest.error
    await this.writeManifest(manifest)
    await rm(chunks, { recursive: true, force: true })
    // The compressed copy is what is kept for listening; the large originals go unless asked for.
    if (!this.setting<boolean>('meetings.keepOriginal', MEETINGS_DEFAULTS.keepOriginal, (value) => typeof value === 'boolean')) {
      for (const stream of streams) if ((await sizeOf(join(dir, `${stream}.webm`))) > 0) await rm(join(dir, `${stream}.wav`), { force: true })
    }
    this.setRow(pageId, { status: 'ready' })
    job.percent = 100
    this.options.emitProgress({ kind: 'transcribe', pageId, percent: 100 })
  }

  /** The child page "Transcript" of a meeting: made, or its content replaced. Returns its id. */
  private writeTranscriptPage(pageId: string, manifest: Manifest, paragraphs: readonly Paragraph[]): string {
    const children: TreeInput[] = paragraphs.length
      ? paragraphs.map((paragraph) => ({ type: 'text', props: { title: paragraphSpans(paragraph, manifest.speakers) } }))
      : [{ type: 'text', props: { title: [['No speech was found in this recording.']] } }]
    const existing = manifest.transcriptPageId ? this.repo.get(manifest.transcriptPageId) : null
    return this.repo.transaction(() => {
      if (existing && existing.type === 'page' && existing.parentId === pageId && existing.trashedAt === null) {
        for (const child of this.repo.children(existing.id)) if (child.type !== 'page' && child.type !== 'database') this.repo.delete(child.id)
        for (const child of children) this.repo.createTree(child, existing.id)
        return existing.id
      }
      return this.repo.createTree({ type: 'page', props: { title: [[TRANSCRIPT_TITLE]], icon: '\u{1F4DD}' }, children }, pageId).id
    })
  }

  /** Renames the two speakers of a meeting, in what is stored and in the transcript page. */
  async setSpeakers(rawPageId: unknown, rawSpeakers: unknown): Promise<MeetingAudioInfo> {
    const pageId = arg.id(rawPageId, 'pageId')
    const raw = arg.plainObject(rawSpeakers, 'speakers')
    const manifest = await this.readManifest(pageId)
    if (!manifest) throw new Error('This meeting has no recording.')
    const next: Speakers = { mic: cleanSpeaker(raw['mic'], DEFAULT_SPEAKERS.mic), system: cleanSpeaker(raw['system'], DEFAULT_SPEAKERS.system) }
    if (next.mic === next.system) throw new Error('The two speakers need different names.')
    const previous = manifest.speakers
    const page = manifest.transcriptPageId ? this.repo.get(manifest.transcriptPageId) : null
    if (page && page.trashedAt === null) {
      // Through a placeholder, so that swapping the two names does not merge them.
      const steps: [string, string][] = [
        [previous.mic, '\u0000mic'],
        [previous.system, next.system],
        ['\u0000mic', next.mic]
      ]
      this.repo.transaction(() => {
        for (const block of this.repo.children(page.id)) {
          let title = block.props.title
          let changed = false
          for (const [from, to] of steps) {
            const renamed = renameSpeakerSpans(title, from, to)
            if (renamed) {
              title = renamed
              changed = true
            }
          }
          if (changed) this.repo.update(block.id, { props: { title } })
        }
      })
    }
    await this.writeManifest({ ...manifest, speakers: next })
    this.options.flushChanges()
    return this.info(pageId)
  }

  /** The app is quitting: the files are closed properly and no program survives it. */
  async dispose(): Promise<void> {
    this.job?.abort.abort()
    if (this.live) await this.finalise(this.live, null)
    this.disposed = true
  }
}
