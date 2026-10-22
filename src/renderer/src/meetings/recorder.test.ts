import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECORDER_COPY } from './copy'

// The recorder in Node: devices, Web Audio and MediaRecorder are small fakes, so what is checked
// is what the user is told and what the bar shows when the main process refuses.

const notifyError = vi.fn()
vi.mock('@/ui/toast', () => ({ notifyError: (...args: unknown[]) => notifyError(...args) }))
vi.mock('@/home/store', () => ({ useHome: { getState: () => ({ locale: 'en' }) } }))
vi.mock('./pcm-worklet.js?url&no-inline', () => ({ default: 'worklet.js' }))

class FakeRecorder {
  static isTypeSupported(): boolean {
    return true
  }
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  ondataavailable: ((event: unknown) => void) | null = null
  private stopped: (() => void)[] = []
  start(): void {
    this.state = 'recording'
  }
  pause(): void {
    this.state = 'paused'
  }
  resume(): void {
    this.state = 'recording'
  }
  stop(): void {
    this.state = 'inactive'
    for (const listener of this.stopped.splice(0)) listener()
  }
  addEventListener(_name: string, listener: () => void): void {
    this.stopped.push(listener)
  }
}

let recorders: FakeRecorder[]
let onEnded: (() => void) | null
let recording: Record<'begin' | 'frames' | 'encoded' | 'pause' | 'resume' | 'stop', ReturnType<typeof vi.fn>>

beforeEach(() => {
  vi.resetModules()
  notifyError.mockReset()
  recorders = []
  onEnded = null
  recording = {
    begin: vi.fn(async () => ({ token: 't1', system: false })),
    frames: vi.fn(),
    encoded: vi.fn(),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(async () => null)
  }
  const track = {
    stop: vi.fn(),
    addEventListener: (_name: string, listener: () => void) => {
      onEnded = listener
    }
  }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  vi.stubGlobal('window', { api: { meetings: { recording } } })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => stream } })
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      audioWorklet = { addModule: async () => undefined }
      createMediaStreamSource = () => ({ connect: () => undefined })
      close = async () => undefined
    }
  )
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null }
    }
  )
  vi.stubGlobal(
    'MediaRecorder',
    class extends FakeRecorder {
      constructor() {
        super()
        recorders.push(this)
      }
    }
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function started() {
  const recorder = await import('./recorder')
  await recorder.startRecording('p1', { micId: null, system: false })
  expect(recorder.useRecorder.getState().session?.state).toBe('recording')
  return recorder
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('the recorder when the main process refuses', () => {
  it('pauses when main agrees', async () => {
    const recorder = await started()
    recorder.pauseRecording()
    await flush()
    expect(recorder.useRecorder.getState().session?.state).toBe('paused')
    expect(recorders[0].state).toBe('paused')
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('keeps recording, and says so, when the pause fails', async () => {
    const recorder = await started()
    recording.pause.mockRejectedValueOnce(new Error('gone'))
    recorder.pauseRecording()
    await flush()
    expect(recorder.useRecorder.getState().session?.state).toBe('recording')
    expect(recorders[0].state).toBe('recording')
    expect(notifyError).toHaveBeenCalledWith(RECORDER_COPY.en.pauseFailed, expect.any(Error))
  })

  it('stays paused, and says so, when resuming fails', async () => {
    const recorder = await started()
    recorder.pauseRecording()
    await flush()
    recording.resume.mockRejectedValueOnce(new Error('gone'))
    recorder.resumeRecording()
    await flush()
    expect(recorder.useRecorder.getState().session?.state).toBe('paused')
    expect(recorders[0].state).toBe('paused')
    expect(notifyError).toHaveBeenCalledWith(RECORDER_COPY.en.resumeFailed, expect.any(Error))
  })

  it('tells the user when the microphone goes away and the recording cannot be saved', async () => {
    const recorder = await started()
    recording.stop.mockRejectedValueOnce(new Error('disk'))
    onEnded?.()
    await flush()
    await flush()
    expect(recorder.useRecorder.getState().session).toBeNull()
    expect(notifyError).toHaveBeenCalledWith(RECORDER_COPY.en.stopFailed, expect.any(Error))
  })
})
