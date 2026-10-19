/**
 * Meeting recording: the shapes shared by the main process (which owns the audio files, the
 * transcription program and every permission decision) and the renderer (which captures the
 * microphone and the computer's audio and shows what is going on).
 *
 * Audio never leaves the computer. The one time this feature goes online is the download of
 * the open-source whisper.cpp program and a speech model, after the user asked for it.
 */

/** What is written to disk while recording: mono, 16 kHz, 16-bit little-endian PCM. */
export const PCM = { sampleRate: 16_000, bytesPerSample: 2 } as const

export type MeetingStream = 'mic' | 'system'
export const MEETING_STREAMS: readonly MeetingStream[] = ['mic', 'system']

export const MEETING_LIMITS = {
  title: 300,
  /** Samples of one stream in one `frames` message (4 s); the recorder sends 100 ms at a time. */
  frameSamples: 64_000,
  /** How far ahead of the last message a sequence number may be before the recording is refused. */
  sequenceGap: 600,
  /** One chunk of compressed audio (the recorder cuts one every few seconds). */
  encodedBytes: 4 * 1024 * 1024,
  /** Compressed audio of one stream, in total. */
  encodedTotalBytes: 512 * 1024 * 1024,
  maxHours: { min: 0.25, max: 8, default: 4 },
  /** Free space needed to start, and below which a recording stops by itself. */
  minFreeBytes: 500 * 1024 * 1024,
  stopFreeBytes: 150 * 1024 * 1024,
  /** Both inputs quieter than `silencePeak` for this long: the bar offers to stop. */
  silenceMs: 10 * 60 * 1000,
  silencePeak: 0.008,
  /** A grant to open the microphone and the computer's audio is good for this long. */
  grantMs: 8000,
  speaker: 40,
  /** Characters of the Attendees a meeting page is given from its calendar event. */
  attendees: 1000
} as const

export interface MeetingSources {
  /** A device id from `enumerateDevices`, or null for the system's default microphone. */
  micId: string | null
  /** Record what the computer plays (the other people in a call). */
  system: boolean
}

export interface MeetingEventContext {
  title: string
  start: number
  end: number
  location?: string
  description?: string
  /**
   * The calendar event's UID. The page remembers it with the start (`props.meetingEvent`), and
   * a second `create` for the same occurrence opens that page instead of making another.
   */
  uid?: string
}

export interface MeetingCreateInput {
  title?: string
  event?: MeetingEventContext
}

export type RecordingState = 'recording' | 'paused'

export interface ActiveRecording {
  pageId: string
  state: RecordingState
  /** Milliseconds of audio written so far. */
  elapsedMs: number
  mic: boolean
  system: boolean
  /** True once both inputs have been silent for ten minutes. */
  silent: boolean
}

export interface InterruptedRecording {
  pageId: string
  title: string
  /** Seconds of audio that are on disk. */
  seconds: number
  startedAt: number
}

export interface TranscribeProgress {
  pageId: string
  /** 0–100 over both streams. */
  percent: number
}

/** Why a recording ended without the user asking. */
export type RecordingNotice = 'max-duration' | 'disk-low' | 'interrupted' | 'failed'

export interface MeetingsStatus {
  /** False where the computer's audio cannot be captured (anything but Windows for now). */
  systemAudio: boolean
  /** The "Meetings" database, once it exists. */
  databaseId: string | null
  recording: ActiveRecording | null
  transcribing: TranscribeProgress | null
  interrupted: InterruptedRecording[]
  /** Set on the status sent when a recording was stopped by the app itself. */
  notice?: { pageId: string; reason: RecordingNotice }
}

export type MeetingAudioState = 'none' | 'recording' | 'recorded' | 'transcribing' | 'ready' | 'failed'

export interface MeetingTrack {
  stream: MeetingStream
  /** A `sel-file://recordings/…` address the player can load. */
  url: string
  format: 'webm' | 'wav'
}

export interface MeetingAudioInfo {
  state: MeetingAudioState
  /** Seconds recorded. */
  seconds: number
  /** What can be played; empty once the audio was deleted. */
  tracks: MeetingTrack[]
  bytes: number
  transcriptPageId: string | null
  speakers: { mic: string; system: string }
  /** What went wrong the last time transcription was tried. */
  error?: string
}

export const WHISPER_MODELS = ['base', 'small', 'medium', 'large-v3-turbo'] as const
export type WhisperModelId = (typeof WHISPER_MODELS)[number]

export const WHISPER_MODEL_LABELS: Record<WhisperModelId, string> = {
  small: 'Small — faster, good for clear audio',
  base: 'Base — fastest',
  medium: 'Medium — more accurate, slower',
  'large-v3-turbo': 'Large v3 turbo — most accurate on fast machines'
}

export type EngineState = 'ready' | 'missing-program' | 'missing-model' | 'unsupported'

export interface EngineDownload {
  phase: 'program' | 'model' | 'verifying' | 'unpacking'
  received: number
  total: number
}

export interface EngineStatus {
  state: EngineState
  /** True when sel can download the program for this system (digests are pinned for it). */
  canDownload: boolean
  /** The program in use: sel's own copy, or one the user chose. */
  program?: { path: string; managed: boolean; version: string }
  model?: { path: string; managed: boolean; id: WhisperModelId | null; bytes: number }
  /** What a download would fetch: sizes in bytes, per model. */
  offer: { version: string; programBytes: number; models: Record<WhisperModelId, number> }
  download: EngineDownload | null
  /** The last download or check that failed, in plain words. */
  error?: string
}

export type MeetingsProgress =
  | ({ kind: 'download' } & EngineDownload)
  | { kind: 'download-done'; ok: boolean; message?: string }
  | ({ kind: 'transcribe' } & TranscribeProgress)

export const MEETINGS_CHANNELS = {
  status: 'meetings:status',
  progress: 'meetings:progress',
  /** main → the recording window: stop now (the window is closing, a limit was reached). */
  stop: 'meetings:stop',
  /** renderer → main, fire-and-forget binary: PCM frames and compressed chunks. */
  frames: 'meetings:recording.frames',
  encoded: 'meetings:recording.encoded'
} as const

export interface BeginResult {
  /** Identifies this recording on the binary channels; worthless once it stops. */
  token: string
  /** False when "Computer audio" was asked for but this system cannot capture it. */
  system: boolean
}

export interface MeetingsApi {
  status(): Promise<MeetingsStatus>
  engine: {
    status(): Promise<EngineStatus>
    /** Downloads the pinned whisper.cpp program (when missing) and one model. Progress arrives as events. */
    download(options: { model: WhisperModelId }): Promise<EngineStatus>
    cancelDownload(): Promise<void>
    /** Native file dialogs: the only way a path enters `meetings.whisperPath` / `meetings.modelPath`. */
    pickProgram(): Promise<EngineStatus | null>
    pickModel(): Promise<EngineStatus | null>
    /** Deletes sel's own copy of the program and its models, and forgets chosen paths. */
    remove(): Promise<EngineStatus>
  }
  /** Creates a page in the "Meetings" database (made on first use), or finds the one already made for the event (`existing`). */
  create(input?: MeetingCreateInput): Promise<{ pageId: string; existing?: boolean }>
  recording: {
    /** A short grant to list microphones (labels need the microphone open for a moment). */
    probe(): Promise<void>
    begin(pageId: string, options: { sources: MeetingSources }): Promise<BeginResult>
    frames(token: string, seq: number, mic: ArrayBuffer | null, system: ArrayBuffer | null): void
    encoded(token: string, stream: MeetingStream, seq: number, bytes: ArrayBuffer): void
    pause(token: string): Promise<void>
    resume(token: string): Promise<void>
    stop(token: string): Promise<MeetingAudioInfo>
    /** Finishes the files of a recording an earlier run of the app did not get to stop. */
    recover(pageId: string): Promise<MeetingAudioInfo>
    /** Forgets an interrupted recording and deletes what it left. */
    discard(pageId: string): Promise<void>
  }
  transcribe(pageId: string): Promise<void>
  cancelTranscribe(pageId: string): Promise<void>
  setSpeakers(pageId: string, speakers: { mic: string; system: string }): Promise<MeetingAudioInfo>
  audio: {
    info(pageId: string): Promise<MeetingAudioInfo>
    /** Deletes the audio of one meeting. Its page and transcript stay. */
    delete(pageId: string): Promise<MeetingAudioInfo>
  }
  /** Bytes the recordings take, how many meetings have any, and bytes of the downloaded program and models. */
  storage(): Promise<{ bytes: number; meetings: number; engineBytes: number }>
  openFolder(): Promise<void>
  onStatus(listener: (status: MeetingsStatus) => void): () => void
  onProgress(listener: (progress: MeetingsProgress) => void): () => void
  onStop(listener: (pageId: string) => void): () => void
}

// ---- settings ---------------------------------------------------------------

export const MEETING_LANGUAGES = ['auto', 'pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'zh'] as const
export type MeetingLanguage = (typeof MEETING_LANGUAGES)[number]

export const MEETING_LANGUAGE_LABELS: Record<MeetingLanguage, string> = {
  auto: 'Detect automatically',
  pt: 'Portuguese',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  ja: 'Japanese',
  zh: 'Chinese'
}

export const DELETE_AFTER_DAYS = [0, 7, 30, 90] as const

/**
 * The keys a renderer may write. `meetings.whisperPath` and `meetings.modelPath` are listed so
 * that they can be cleared; a value for them only ever comes out of a native file dialog.
 */
export const MEETINGS_KEYS = [
  'meetings.whisperPath',
  'meetings.modelPath',
  'meetings.model',
  'meetings.language',
  'meetings.keepOriginal',
  'meetings.deleteAfterDays',
  'meetings.maxHours',
  'meetings.defaultSystem',
  'meetings.defaultMic',
  'meetings.consentReminder'
] as const

export const MEETINGS_DEFAULTS = {
  model: 'small' as WhisperModelId,
  language: 'auto' as MeetingLanguage,
  keepOriginal: false,
  deleteAfterDays: 0,
  defaultSystem: true,
  consentReminder: true
} as const

export function isWhisperModel(value: unknown): value is WhisperModelId {
  return typeof value === 'string' && (WHISPER_MODELS as readonly string[]).includes(value)
}

export function isMeetingLanguage(value: unknown): value is MeetingLanguage {
  return typeof value === 'string' && (MEETING_LANGUAGES as readonly string[]).includes(value)
}

const DEVICE_ID_RE = /^[A-Za-z0-9+/=_-]{1,128}$/

/** A remembered microphone: the id `enumerateDevices` gave it and the name it showed. */
export function cleanMic(value: unknown): { id: string; label: string } | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const { id, label } = value as { id?: unknown; label?: unknown }
  if (typeof id !== 'string' || !DEVICE_ID_RE.test(id) || typeof label !== 'string') return undefined
  return {
    id,
    label: label
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
  }
}

/** The value a meetings setting accepts from a renderer, or undefined when it does not. */
export function cleanMeetingsSetting(key: string, value: unknown): unknown {
  switch (key) {
    case 'meetings.model':
      return isWhisperModel(value) ? value : undefined
    case 'meetings.language':
      return isMeetingLanguage(value) ? value : undefined
    case 'meetings.keepOriginal':
    case 'meetings.defaultSystem':
    case 'meetings.consentReminder':
      return typeof value === 'boolean' ? value : undefined
    case 'meetings.deleteAfterDays':
      return (DELETE_AFTER_DAYS as readonly unknown[]).includes(value) ? value : undefined
    case 'meetings.maxHours':
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
      return Math.min(MEETING_LIMITS.maxHours.max, Math.max(MEETING_LIMITS.maxHours.min, value))
    case 'meetings.defaultMic':
      return cleanMic(value)
    default:
      // The two paths: never from a renderer.
      return undefined
  }
}

/** `754` → `12:34`; an hour or more → `1:02:03`. */
export function clockTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}

/** The reverse of `clockTime`, or null when the text is not a time. */
export function parseClockTime(text: string): number | null {
  const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

export const RECORDINGS_HOST = 'recordings'
export const TRANSCRIPT_TITLE = 'Transcript'
export const MEETINGS_TITLE = 'Meetings'
