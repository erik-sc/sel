// Capturing a meeting: the microphone and, where the system allows it, what the computer plays.
// One recording at a time, owned by this module rather than by a component, so that it goes on
// while the user moves between pages and tabs. Loaded on demand.
//
// The two sources stay separate from the device to the disk. Each is read twice: as 16 kHz
// 16-bit PCM (an AudioWorklet, 100 ms at a time, appended to a WAV by the main process: what
// the transcription reads) and as Opus in WebM (the browser's recorder: what is kept to listen to).
import { create } from 'zustand'
import { PCM, type MeetingAudioInfo, type MeetingSources, type MeetingStream } from '@shared/meetings'
import workletUrl from './pcm-worklet.js?url&no-inline'

export interface RecorderSession {
  pageId: string
  state: 'starting' | 'recording' | 'paused' | 'stopping'
  /** Milliseconds of audio sent to the main process. */
  elapsedMs: number
  /** True while the computer's audio is really being captured. */
  system: boolean
  /** Why the computer's audio is not there, when it was asked for. */
  systemNote: string | null
}

export const useRecorder = create<{ session: RecorderSession | null }>(() => ({ session: null }))

/** The loudest recent sample of each input, 0–1. Read by the meters on every frame; not React state. */
export const levels = { mic: 0, system: 0 }

interface Capture {
  token: string
  context: AudioContext
  streams: MediaStream[]
  recorders: MediaRecorder[]
  /** Pending writes of compressed chunks, in order. */
  tail: Promise<void>
  seq: number
  encodedSeq: Record<MeetingStream, number>
  samples: number
  sendsSystem: boolean
}

let capture: Capture | null = null
const OPUS = 'audio/webm;codecs=opus'
/** Speech needs little: about 14 MB an hour for each stream. */
const OPUS_BITS = 32_000
const CHUNK_MS = 4000

function patch(change: Partial<RecorderSession>): void {
  const { session } = useRecorder.getState()
  if (session) useRecorder.setState({ session: { ...session, ...change } })
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) return 'The microphone could not be opened. Check that Windows lets desktop apps use it.'
  if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) return 'No microphone was found.'
  if (error instanceof DOMException && error.name === 'NotReadableError') return 'The microphone is in use by another program or could not be read.'
  return text || 'The recording could not be started.'
}

function encodedRecorder(owner: Capture, stream: MediaStream, name: MeetingStream): MediaRecorder | null {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported(OPUS)) return null
  const recorder = new MediaRecorder(stream, { mimeType: OPUS, audioBitsPerSecond: OPUS_BITS })
  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return
    // Chunks must reach the file in the order they were cut, whatever order their bytes are read in.
    owner.tail = owner.tail
      .then(() => event.data.arrayBuffer())
      .then((bytes) => {
        if (capture === owner) window.api.meetings.recording.encoded(owner.token, name, owner.encodedSeq[name]++, bytes)
      })
      .catch(() => undefined)
  }
  recorder.start(CHUNK_MS)
  return recorder
}

function release(owner: Capture): void {
  for (const recorder of owner.recorders) {
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } catch {
      /* already stopped */
    }
  }
  for (const stream of owner.streams) for (const track of stream.getTracks()) track.stop()
  void owner.context.close().catch(() => undefined)
  levels.mic = 0
  levels.system = 0
}

/**
 * Starts recording into the meeting `pageId`. Must be called from a click: asking the main
 * process to begin is what opens, for a few seconds, the permission to use the microphone.
 * Resolves once audio flows; rejects with a sentence to show.
 */
export async function startRecording(pageId: string, sources: MeetingSources): Promise<void> {
  if (capture || useRecorder.getState().session) throw new Error('A meeting is already being recorded.')
  useRecorder.setState({ session: { pageId, state: 'starting', elapsedMs: 0, system: false, systemNote: null } })
  let begun: { token: string; system: boolean } | null = null
  const streams: MediaStream[] = []
  let context: AudioContext | null = null
  try {
    begun = await window.api.meetings.recording.begin(pageId, { sources })
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { ...(sources.micId ? { deviceId: { ideal: sources.micId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    })
    streams.push(mic)

    let system: MediaStream | null = null
    let systemNote: string | null = sources.system && !begun.system ? 'Computer audio is not available on this system.' : null
    if (begun.system) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: true })
        // Only the sound is wanted: the picture is dropped before a frame of it is read.
        for (const track of display.getVideoTracks()) {
          track.stop()
          display.removeTrack(track)
        }
        if (display.getAudioTracks().length) {
          system = new MediaStream(display.getAudioTracks())
          streams.push(system)
        } else systemNote = 'Computer audio could not be captured, so only the microphone is recorded.'
      } catch {
        systemNote = 'Computer audio could not be captured, so only the microphone is recorded.'
      }
    }

    context = new AudioContext({ sampleRate: PCM.sampleRate, latencyHint: 'playback' })
    await context.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(context, 'sel-pcm', { numberOfInputs: 2, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' })
    context.createMediaStreamSource(mic).connect(node, 0, 0)
    if (system) context.createMediaStreamSource(system).connect(node, 0, 1)

    const owner: Capture = { token: begun.token, context, streams, recorders: [], tail: Promise.resolve(), seq: 0, encodedSeq: { mic: 0, system: 0 }, samples: 0, sendsSystem: begun.system }
    node.port.onmessage = (event: MessageEvent<{ mic: ArrayBuffer; system: ArrayBuffer; micPeak: number; systemPeak: number }>) => {
      if (capture !== owner) return
      const { session } = useRecorder.getState()
      levels.mic = Math.max(event.data.micPeak, levels.mic * 0.8)
      levels.system = Math.max(event.data.systemPeak, levels.system * 0.8)
      if (session?.state !== 'recording') return
      // The main process was told which streams to expect; where the loopback failed it gets silence.
      window.api.meetings.recording.frames(owner.token, owner.seq++, event.data.mic, owner.sendsSystem ? event.data.system : null)
      owner.samples += event.data.mic.byteLength / PCM.bytesPerSample
      const elapsedMs = Math.round((owner.samples / PCM.sampleRate) * 1000)
      // Once a second is enough for a clock.
      if (Math.floor(elapsedMs / 1000) !== Math.floor(session.elapsedMs / 1000)) patch({ elapsedMs })
    }
    const micRecorder = encodedRecorder(owner, mic, 'mic')
    if (micRecorder) owner.recorders.push(micRecorder)
    const systemRecorder = system ? encodedRecorder(owner, system, 'system') : null
    if (systemRecorder) owner.recorders.push(systemRecorder)
    // The microphone was unplugged: what was recorded is saved.
    mic.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (capture === owner) void stopRecording().catch(() => undefined)
    })
    if (context.state === 'suspended') await context.resume()
    capture = owner
    patch({ state: 'recording', system: system !== null, systemNote })
  } catch (error) {
    for (const stream of streams) for (const track of stream.getTracks()) track.stop()
    void context?.close().catch(() => undefined)
    useRecorder.setState({ session: null })
    // Main began a recording that never got a sample: stopping it removes every trace.
    if (begun) await window.api.meetings.recording.stop(begun.token).catch(() => undefined)
    throw new Error(message(error))
  }
}

export function pauseRecording(): void {
  const owner = capture
  if (!owner || useRecorder.getState().session?.state !== 'recording') return
  patch({ state: 'paused' })
  for (const recorder of owner.recorders) if (recorder.state === 'recording') recorder.pause()
  void window.api.meetings.recording.pause(owner.token).catch(() => undefined)
}

export function resumeRecording(): void {
  const owner = capture
  if (!owner || useRecorder.getState().session?.state !== 'paused') return
  for (const recorder of owner.recorders) if (recorder.state === 'paused') recorder.resume()
  patch({ state: 'recording' })
  void window.api.meetings.recording.resume(owner.token).catch(() => undefined)
}

/** Stops, lets the last compressed chunks through, and has the main process close the files. */
export async function stopRecording(): Promise<MeetingAudioInfo | null> {
  const owner = capture
  if (!owner) return null
  patch({ state: 'stopping' })
  try {
    await Promise.all(
      owner.recorders.map(
        (recorder) =>
          new Promise<void>((resolve) => {
            if (recorder.state === 'inactive') return resolve()
            recorder.addEventListener('stop', () => resolve(), { once: true })
            recorder.stop()
          })
      )
    )
    await Promise.race([owner.tail, new Promise((resolve) => setTimeout(resolve, 3000))])
    return await window.api.meetings.recording.stop(owner.token)
  } finally {
    capture = null
    release(owner)
    useRecorder.setState({ session: null })
  }
}

/** The main process ended the recording itself (a limit, the window closing): let go of the devices. */
export function abandonRecording(): void {
  const owner = capture
  capture = null
  if (owner) release(owner)
  useRecorder.setState({ session: null })
}

/**
 * The microphones of this computer, with their names. Names are only told while the
 * microphone is open, so this opens it for a moment (under a grant asked for here) and closes it.
 */
export async function listMicrophones(): Promise<{ id: string; label: string }[]> {
  await window.api.meetings.recording.probe()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')
      .map((device) => ({ id: device.deviceId, label: device.label || 'Microphone' }))
  } finally {
    for (const track of stream.getTracks()) track.stop()
  }
}

let listening = false

/** Wires the one message the main process sends a recording window. Idempotent. */
export function listenForStop(): void {
  if (listening) return
  listening = true
  window.api.meetings.onStop(() => abandonRecording())
}
