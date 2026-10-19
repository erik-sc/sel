import { MEETING_LIMITS, PCM, type MeetingStream } from '../../shared/meetings'

/**
 * Checks what arrives on the binary channels of a recording before a byte is written. Pure
 * (unit-tested): the service owns the files, this decides whether a message may reach them.
 *
 * A message names no file. It carries the token of the recording it belongs to, a sequence
 * number and the samples; where they go was decided when the recording began.
 */

export type FrameRefusal =
  | 'not-recording'
  | 'wrong-token'
  | 'wrong-sender'
  | 'bad-shape'
  | 'bad-sequence'
  | 'too-large'
  | 'unexpected-stream'
  | 'full'

export type FrameVerdict =
  | { ok: true; mic: Uint8Array | null; system: Uint8Array | null /** Messages that never arrived before this one. */; skipped: number }
  | { ok: false; reason: FrameRefusal /** True when the recording must end: the stream cannot be trusted any more. */; fatal: boolean }

export interface FrameSession {
  token: string
  owner: number
  mic: boolean
  system: boolean
  /** Samples one stream may hold in total (the maximum duration). */
  maxSamples: number
}

function bytesOf(value: unknown): Uint8Array | null | undefined {
  if (value === null || value === undefined) return null
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}

export class FrameGate {
  private nextSeq = 0
  private samples = 0
  private readonly encodedSeq: Record<MeetingStream, number> = { mic: 0, system: 0 }
  private readonly encodedBytes: Record<MeetingStream, number> = { mic: 0, system: 0 }
  private closed = false

  constructor(private readonly session: FrameSession) {}

  /** After this every message is refused. */
  close(): void {
    this.closed = true
  }

  get samplesWritten(): number {
    return this.samples
  }

  private identify(sender: number, token: unknown): FrameVerdict | null {
    if (this.closed) return { ok: false, reason: 'not-recording', fatal: false }
    if (sender !== this.session.owner) return { ok: false, reason: 'wrong-sender', fatal: false }
    if (typeof token !== 'string' || token.length !== this.session.token.length || token !== this.session.token) {
      return { ok: false, reason: 'wrong-token', fatal: false }
    }
    return null
  }

  /** One batch of PCM: the same number of samples for every stream being recorded. */
  frames(sender: number, token: unknown, seq: unknown, rawMic: unknown, rawSystem: unknown): FrameVerdict {
    const refused = this.identify(sender, token)
    if (refused) return refused
    const fatal = (reason: FrameRefusal): FrameVerdict => ({ ok: false, reason, fatal: true })
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return fatal('bad-shape')
    // A repeat or a step back is dropped; a gap is tolerated (a busy moment lost a batch) up to a point.
    if (seq < this.nextSeq) return { ok: false, reason: 'bad-sequence', fatal: false }
    if (seq - this.nextSeq > MEETING_LIMITS.sequenceGap) return fatal('bad-sequence')
    const mic = bytesOf(rawMic)
    const system = bytesOf(rawSystem)
    if (mic === undefined || system === undefined) return fatal('bad-shape')
    if ((mic !== null) !== this.session.mic || (system !== null) !== this.session.system) return fatal('unexpected-stream')
    const length = (mic ?? system)?.byteLength ?? 0
    if (length === 0 || length % PCM.bytesPerSample !== 0) return fatal('bad-shape')
    if (mic && system && mic.byteLength !== system.byteLength) return fatal('bad-shape')
    const count = length / PCM.bytesPerSample
    if (count > MEETING_LIMITS.frameSamples) return fatal('too-large')
    if (this.samples + count > this.session.maxSamples) return { ok: false, reason: 'full', fatal: true }
    const skipped = seq - this.nextSeq
    this.nextSeq = seq + 1
    this.samples += count
    return { ok: true, mic, system, skipped }
  }

  /** One chunk of compressed audio for one stream. Strictly in order: a container cannot have holes. */
  encoded(
    sender: number,
    token: unknown,
    stream: unknown,
    seq: unknown,
    raw: unknown
  ): { ok: true; stream: MeetingStream; bytes: Uint8Array } | { ok: false; reason: FrameRefusal } {
    const refused = this.identify(sender, token)
    if (refused && !refused.ok) return { ok: false, reason: refused.reason }
    if (stream !== 'mic' && stream !== 'system') return { ok: false, reason: 'bad-shape' }
    if (!this.session[stream]) return { ok: false, reason: 'unexpected-stream' }
    if (typeof seq !== 'number' || seq !== this.encodedSeq[stream]) return { ok: false, reason: 'bad-sequence' }
    const bytes = bytesOf(raw)
    if (!bytes || bytes.byteLength === 0) return { ok: false, reason: 'bad-shape' }
    if (bytes.byteLength > MEETING_LIMITS.encodedBytes) return { ok: false, reason: 'too-large' }
    if (this.encodedBytes[stream] + bytes.byteLength > MEETING_LIMITS.encodedTotalBytes) return { ok: false, reason: 'full' }
    this.encodedSeq[stream] += 1
    this.encodedBytes[stream] += bytes.byteLength
    return { ok: true, stream, bytes }
  }
}
