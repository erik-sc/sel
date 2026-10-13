import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MEETING_LIMITS, PCM } from '../../shared/meetings'
import { FrameGate } from './frames'
import { GrantStore } from './grant'
import { parseRange, recordingUrl, resolveRecordingUrl, serveRecording } from './serve'
import { patchedHead, patchWebmDuration } from './webm'
import { parseWavHeader, peakOf, readWavInfo, repairWav, sliceWav, WAV_HEADER_BYTES, wavHeader, WavWriter } from './wav'

const ROOT = mkdtempSync(join(tmpdir(), 'selida-meetings-audio-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
let serial = 0
const fresh = (name: string): string => join(ROOT, `${++serial}-${name}`)

function tone(seconds: number, amplitude = 0.4): Uint8Array {
  const samples = new Int16Array(Math.round(seconds * PCM.sampleRate))
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin((i / PCM.sampleRate) * 2 * Math.PI * 440) * amplitude * 32767)
  return new Uint8Array(samples.buffer)
}

describe('wav files', () => {
  it('writes a header that describes 16 kHz mono 16-bit PCM', () => {
    const header = wavHeader(32_000)
    expect(header.length).toBe(WAV_HEADER_BYTES)
    expect(header.toString('ascii', 0, 4)).toBe('RIFF')
    expect(header.readUInt32LE(4)).toBe(36 + 32_000)
    expect(header.readUInt32LE(24)).toBe(16_000)
    expect(header.readUInt32LE(28)).toBe(32_000)
    expect(parseWavHeader(header)).toEqual({ sampleRate: 16_000, dataBytes: 32_000 })
    expect(parseWavHeader(Buffer.from('not a wav file at all, but long enough to be one'))).toBeNull()
  })

  it('appends samples and fixes the lengths up on close', async () => {
    const file = fresh('a.wav')
    const writer = new WavWriter(file)
    expect(writer.append(tone(0.5))).toBe(true)
    expect(writer.append(tone(0.25))).toBe(true)
    // While recording the header still says "empty": the samples are on disk all the same.
    expect(parseWavHeader(readFileSync(file))?.dataBytes).toBe(0)
    expect(statSync(file).size).toBe(WAV_HEADER_BYTES + 24_000)
    expect(writer.seconds).toBeCloseTo(0.75)
    writer.close()
    writer.close()
    expect(writer.append(tone(0.1))).toBe(false)
    expect(await readWavInfo(file)).toEqual({ sampleRate: 16_000, dataBytes: 24_000, seconds: 0.75 })
    expect(peakOf(readFileSync(file).subarray(WAV_HEADER_BYTES))).toBeGreaterThan(0.3)
  })

  it('refuses half samples, more than its cap, and an existing file', () => {
    const file = fresh('b.wav')
    const writer = new WavWriter(file, 1000)
    expect(writer.append(new Uint8Array(3))).toBe(false)
    expect(writer.append(new Uint8Array(1000))).toBe(true)
    expect(writer.append(new Uint8Array(2))).toBe(false)
    writer.close()
    expect(() => new WavWriter(file)).toThrow()
  })

  it('recovers a file whose recording never stopped, dropping a torn last sample', async () => {
    const file = fresh('crash.wav')
    const writer = new WavWriter(file)
    writer.append(tone(2))
    // The process died here: no close. And the last write was cut in the middle of a sample.
    appendFileSync(file, Buffer.from([0x12]))
    expect((await readWavInfo(file))?.seconds).toBe(0)
    expect(repairWav(file)).toEqual({ sampleRate: 16_000, dataBytes: 64_000, seconds: 2 })
    expect(statSync(file).size).toBe(WAV_HEADER_BYTES + 64_000)
    expect((await readWavInfo(file))?.seconds).toBe(2)
    // Again changes nothing; other files are left alone.
    expect(repairWav(file)?.seconds).toBe(2)
    const other = fresh('other.wav')
    writeFileSync(other, 'x'.repeat(100))
    expect(repairWav(other)).toBeNull()
    expect(readFileSync(other, 'utf8')).toBe('x'.repeat(100))
    expect(repairWav(fresh('missing.wav'))).toBeNull()
  })

  it('cuts a piece out of a recording', async () => {
    const file = fresh('long.wav')
    const writer = new WavWriter(file)
    writer.append(tone(3))
    writer.close()
    const piece = fresh('piece.wav')
    expect(await sliceWav(file, piece, 2, 5)).toBe(1)
    expect(await readWavInfo(piece)).toEqual({ sampleRate: 16_000, dataBytes: 32_000, seconds: 1 })
    expect(await sliceWav(file, fresh('none.wav'), 9, 5)).toBe(0)
  })

  it('tells silence from sound', () => {
    expect(peakOf(new Uint8Array(3200))).toBe(0)
    expect(peakOf(tone(0.1, 0.001))).toBeLessThan(MEETING_LIMITS.silencePeak)
    expect(peakOf(tone(0.1, 0.2))).toBeGreaterThan(MEETING_LIMITS.silencePeak)
  })
})

describe('the frame gate', () => {
  const session = { token: 't'.repeat(32), owner: 7, mic: true, system: true, maxSamples: 16_000 }
  const batch = (samples = 1600): ArrayBuffer => new ArrayBuffer(samples * 2)

  it('accepts batches in order and counts their samples', () => {
    const gate = new FrameGate(session)
    const first = gate.frames(7, session.token, 0, batch(), batch())
    expect(first.ok && first.mic?.byteLength).toBe(3200)
    expect(gate.frames(7, session.token, 1, new Uint8Array(3200), new Int16Array(1600)).ok).toBe(true)
    expect(gate.samplesWritten).toBe(3200)
  })

  it('drops what is not from the recording window or lacks its token', () => {
    const gate = new FrameGate(session)
    expect(gate.frames(8, session.token, 0, batch(), batch())).toEqual({ ok: false, reason: 'wrong-sender', fatal: false })
    expect(gate.frames(7, 'x'.repeat(32), 0, batch(), batch())).toEqual({ ok: false, reason: 'wrong-token', fatal: false })
    expect(gate.frames(7, undefined, 0, batch(), batch())).toMatchObject({ ok: false, reason: 'wrong-token' })
    expect(gate.frames(7, `${session.token}x`, 0, batch(), batch())).toMatchObject({ ok: false, reason: 'wrong-token' })
    expect(gate.samplesWritten).toBe(0)
  })

  it('drops repeats, tolerates a small gap and ends the recording on a large one', () => {
    const gate = new FrameGate(session)
    expect(gate.frames(7, session.token, 0, batch(160), batch(160)).ok).toBe(true)
    expect(gate.frames(7, session.token, 0, batch(160), batch(160))).toEqual({ ok: false, reason: 'bad-sequence', fatal: false })
    const gap = gate.frames(7, session.token, 4, batch(160), batch(160))
    expect(gap.ok && gap.skipped).toBe(3)
    expect(gate.frames(7, session.token, 5 + MEETING_LIMITS.sequenceGap + 1, batch(160), batch(160))).toEqual({ ok: false, reason: 'bad-sequence', fatal: true })
  })

  it.each([
    ['a sequence that is not a whole number', [1.5, batch(), batch()]],
    ['a negative sequence', [-1, batch(), batch()]],
    ['a string for the samples', [0, 'AAAA', batch()]],
    ['an array of numbers', [0, [1, 2, 3, 4], batch()]],
    ['half a sample', [0, new ArrayBuffer(3), new ArrayBuffer(3)]],
    ['empty buffers', [0, new ArrayBuffer(0), new ArrayBuffer(0)]],
    ['streams of different lengths', [0, batch(100), batch(200)]]
  ])('refuses %s', (_name, [seq, mic, system]) => {
    expect(new FrameGate(session).frames(7, session.token, seq, mic, system)).toMatchObject({ ok: false, reason: 'bad-shape', fatal: true })
  })

  it('refuses a stream that was not announced, an oversized batch and more than the maximum length', () => {
    expect(new FrameGate({ ...session, system: false }).frames(7, session.token, 0, batch(), batch())).toMatchObject({ ok: false, reason: 'unexpected-stream' })
    expect(new FrameGate(session).frames(7, session.token, 0, batch(), null)).toMatchObject({ ok: false, reason: 'unexpected-stream' })
    expect(new FrameGate(session).frames(7, session.token, 0, batch(MEETING_LIMITS.frameSamples + 1), batch(MEETING_LIMITS.frameSamples + 1))).toMatchObject({ ok: false, reason: 'too-large' })
    const gate = new FrameGate(session)
    for (let seq = 0; seq < 10; seq++) expect(gate.frames(7, session.token, seq, batch(), batch()).ok).toBe(true)
    expect(gate.frames(7, session.token, 10, batch(), batch())).toEqual({ ok: false, reason: 'full', fatal: true })
  })

  it('refuses everything after the recording stopped', () => {
    const gate = new FrameGate(session)
    gate.close()
    expect(gate.frames(7, session.token, 0, batch(), batch())).toEqual({ ok: false, reason: 'not-recording', fatal: false })
    expect(gate.encoded(7, session.token, 'mic', 0, new ArrayBuffer(10))).toEqual({ ok: false, reason: 'not-recording' })
  })

  it('takes compressed chunks strictly in order, per stream, within the caps', () => {
    const gate = new FrameGate({ ...session, system: false })
    expect(gate.encoded(7, session.token, 'mic', 0, new ArrayBuffer(10))).toMatchObject({ ok: true, stream: 'mic' })
    expect(gate.encoded(7, session.token, 'mic', 2, new ArrayBuffer(10))).toEqual({ ok: false, reason: 'bad-sequence' })
    expect(gate.encoded(7, session.token, 'system', 0, new ArrayBuffer(10))).toEqual({ ok: false, reason: 'unexpected-stream' })
    expect(gate.encoded(7, session.token, '../mic', 1, new ArrayBuffer(10))).toEqual({ ok: false, reason: 'bad-shape' })
    expect(gate.encoded(7, session.token, 'mic', 1, new ArrayBuffer(MEETING_LIMITS.encodedBytes + 1))).toEqual({ ok: false, reason: 'too-large' })
    expect(gate.encoded(9, session.token, 'mic', 1, new ArrayBuffer(10))).toEqual({ ok: false, reason: 'wrong-sender' })
  })
})

describe('recording grants', () => {
  const setup = (): { grants: GrantStore; clock: { t: number } } => {
    const clock = { t: 1000 }
    return { grants: new GrantStore(() => clock.t, 8000), clock }
  }
  const media = (owner: number, mediaTypes: string[], trusted = true): { permission: string; owner: number; trusted: boolean; mediaTypes: string[] } => ({ permission: 'media', owner, trusted, mediaTypes })

  it('denies everything without a grant', () => {
    const { grants } = setup()
    expect(grants.allowRequest(media(1, ['audio']))).toBe(false)
    expect(grants.allowRequest({ permission: 'display-capture', owner: 1, trusted: true })).toBe(false)
    expect(grants.takeSystem(1, true)).toBe(false)
    expect(grants.allowCheck({ permission: 'media', owner: 1, trusted: true, mediaType: 'audio' })).toBe(false)
  })

  it('allows the microphone once, for audio only, for the window that asked', () => {
    const { grants } = setup()
    grants.issue(1, { mic: true, system: false })
    expect(grants.allowRequest(media(2, ['audio']))).toBe(false)
    expect(grants.allowRequest(media(1, ['video']))).toBe(false)
    expect(grants.allowRequest(media(1, ['audio', 'video']))).toBe(false)
    expect(grants.allowRequest(media(1, []))).toBe(false)
    expect(grants.allowRequest(media(1, ['audio'], false))).toBe(false)
    expect(grants.allowRequest({ permission: 'geolocation', owner: 1, trusted: true })).toBe(false)
    expect(grants.allowRequest(media(1, ['audio']))).toBe(true)
    // Used up: a second stream is not handed out on the same grant.
    expect(grants.allowRequest(media(1, ['audio']))).toBe(false)
    // The computer's audio was not asked for.
    expect(grants.allowRequest({ permission: 'display-capture', owner: 1, trusted: true })).toBe(false)
    expect(grants.takeSystem(1, true)).toBe(false)
  })

  it('only opens devices inside the window, but lets a running recording keep its streams', () => {
    const { grants, clock } = setup()
    grants.issue(1, { mic: true, system: true })
    clock.t += 8001
    expect(grants.allowRequest(media(1, ['audio']))).toBe(false)
    expect(grants.takeSystem(1, true)).toBe(false)
    // Checks (is this stream still allowed?) hold for as long as the recording does…
    expect(grants.allowCheck({ permission: 'media', owner: 1, trusted: true, mediaType: 'audio' })).toBe(true)
    expect(grants.allowCheck({ permission: 'media', owner: 1, trusted: true, mediaType: 'video' })).toBe(false)
    expect(grants.allowCheck({ permission: 'media', owner: 1, trusted: false, mediaType: 'audio' })).toBe(false)
    expect(grants.allowCheck({ permission: 'media', owner: 2, trusted: true, mediaType: 'audio' })).toBe(false)
    expect(grants.allowCheck({ permission: 'media', owner: null, trusted: true, mediaType: 'audio' })).toBe(false)
    expect(grants.allowCheck({ permission: 'notifications', owner: 1, trusted: true })).toBe(false)
    // …and end with it.
    grants.revoke(1)
    expect(grants.allowCheck({ permission: 'media', owner: 1, trusted: true, mediaType: 'audio' })).toBe(false)
  })

  it('hands out the loopback once, to a trusted frame, inside the window', () => {
    const { grants } = setup()
    grants.issue(1, { mic: true, system: true })
    expect(grants.allowRequest({ permission: 'display-capture', owner: 1, trusted: true })).toBe(true)
    // How Electron announces getDisplayMedia: a media request without a type. Camera stays refused.
    expect(grants.allowRequest(media(1, []))).toBe(true)
    expect(grants.allowRequest(media(1, [], false))).toBe(false)
    expect(grants.allowRequest(media(2, []))).toBe(false)
    expect(grants.allowRequest(media(1, ['video']))).toBe(false)
    expect(grants.takeSystem(1, false)).toBe(false)
    expect(grants.takeSystem(2, true)).toBe(false)
    expect(grants.takeSystem(1, true)).toBe(true)
    expect(grants.takeSystem(1, true)).toBe(false)
    expect(grants.allowRequest({ permission: 'display-capture', owner: 1, trusted: true })).toBe(false)
    expect(grants.allowRequest(media(1, []))).toBe(false)
  })

  it('gives a probe the microphone only, and lets it lapse by itself', () => {
    const { grants, clock } = setup()
    const grant = grants.issue(1, { mic: true, system: true }, true)
    expect(grant.system).toBe(false)
    expect(grants.takeSystem(1, true)).toBe(false)
    expect(grants.allowRequest(media(1, ['audio']))).toBe(true)
    clock.t += 8001
    expect(grants.allowCheck({ permission: 'media', owner: 1, trusted: true, mediaType: 'audio' })).toBe(false)
    expect(grants.get(1)).toBeNull()
  })

  it('issues tokens that cannot be guessed from one another', () => {
    const { grants } = setup()
    const a = grants.issue(1, { mic: true, system: false }).token
    const b = grants.issue(1, { mic: true, system: false }).token
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })
})

describe('serving recordings', () => {
  const ID = '11111111-2222-4333-8444-555555555555'
  const dir = fresh('recordings')
  mkdirSync(join(dir, ID), { recursive: true })
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
  writeFileSync(join(dir, ID, 'mic.webm'), bytes)
  writeFileSync(join(dir, ID, 'meeting.json'), '{}')
  writeFileSync(join(ROOT, 'secret.wav'), 'secret')
  const get = (url: string, range?: string): Promise<Response> => serveRecording({ method: 'GET', url, headers: { get: (name) => (name === 'range' ? (range ?? null) : null) } }, dir)

  it('maps only the four file names of a meeting folder', () => {
    expect(resolveRecordingUrl(recordingUrl(ID, 'mic', 'webm'), dir)?.file).toBe(join(dir, ID, 'mic.webm'))
    expect(resolveRecordingUrl(recordingUrl(ID, 'system', 'wav'), dir)?.format).toBe('wav')
    for (const url of [
      `selida-file://recordings/${ID}/meeting.json`,
      `selida-file://recordings/${ID}/transcript.json`,
      `selida-file://recordings/${ID}/mic.mp3`,
      `selida-file://recordings/${ID}/chunks/mic.webm`,
      `selida-file://recordings/${ID}/..%2F..%2Fsecret.wav`,
      `selida-file://recordings/${ID}/%2e%2e/mic.webm`,
      `selida-file://recordings/../secret.wav`,
      `selida-file://recordings/..%2Fsecret.wav/mic.wav`,
      `selida-file://recordings/bad.id/mic.webm`,
      `selida-file://recordings//mic.webm`,
      `selida-file://recordings/${ID}/mic.webm?x=1`,
      `selida-file://files/${ID}/mic.webm`,
      `selida-file://user@recordings/${ID}/mic.webm`,
      `file:///${ID}/mic.webm`,
      'not a url'
    ]) {
      expect(resolveRecordingUrl(url, dir), url).toBeNull()
    }
  })

  it('answers whole files and byte ranges as audio', async () => {
    const whole = await get(recordingUrl(ID, 'mic', 'webm'))
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('audio/webm')
    expect(whole.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await whole.arrayBuffer()).equals(bytes)).toBe(true)
    const part = await get(recordingUrl(ID, 'mic', 'webm'), 'bytes=100-199')
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(Buffer.from(await part.arrayBuffer()).equals(bytes.subarray(100, 200))).toBe(true)
    const tail = await get(recordingUrl(ID, 'mic', 'webm'), 'bytes=900-')
    expect(tail.headers.get('content-range')).toBe('bytes 900-999/1000')
    expect((await get(recordingUrl(ID, 'mic', 'webm'), 'bytes=5000-')).status).toBe(416)
  })

  it('answers 404 for anything else, and refuses other methods', async () => {
    expect((await get(recordingUrl(ID, 'system', 'webm'))).status).toBe(404)
    expect((await get(`selida-file://recordings/${ID}/meeting.json`)).status).toBe(404)
    expect((await serveRecording({ method: 'POST', url: recordingUrl(ID, 'mic', 'webm') }, dir)).status).toBe(405)
  })

  it('does not follow a link planted in the folder', async () => {
    try {
      symlinkSync(join(ROOT, 'secret.wav'), join(dir, ID, 'system.wav'))
    } catch {
      return // this account may not create links; the lstat check is what the test is for
    }
    expect((await get(recordingUrl(ID, 'system', 'wav'))).status).toBe(404)
  })

  it('reads range headers', () => {
    expect(parseRange(null, 100)).toBeUndefined()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=10-500', 100)).toEqual({ start: 10, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    for (const bad of ['bytes=100-', 'bytes=20-10', 'bytes=-', 'bytes=a-b', 'items=0-1', 'bytes=0-1,5-6']) expect(parseRange(bad, 100), bad).toBeNull()
  })
})

describe('the length of a compressed recording', () => {
  // What the browser's recorder writes first: an EBML header, a Segment of unknown size, Info, Tracks, a cluster.
  const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x77])
  const segment = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  const info = Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40])
  const tracks = Buffer.from([0x16, 0x54, 0xae, 0x6b, 0x82, 0xae, 0x80])
  const cluster = Buffer.from([0x1f, 0x43, 0xb6, 0x75, 0x84, 1, 2, 3, 4])
  const recording = Buffer.concat([ebml, segment, info, tracks, cluster])

  it('adds a Duration to Info and leaves the rest as it was', () => {
    const patch = patchedHead(recording, 12.5)
    expect(patch).not.toBeNull()
    if (!patch) return
    const out = Buffer.concat([patch.bytes, recording.subarray(patch.replace)])
    // Same start, same tail; in between Info grew by exactly the Duration element (and a longer size field).
    expect(out.subarray(0, ebml.length + segment.length + 4).equals(recording.subarray(0, ebml.length + segment.length + 4))).toBe(true)
    expect(out.subarray(out.length - tracks.length - cluster.length).equals(Buffer.concat([tracks, cluster]))).toBe(true)
    const at = out.indexOf(Buffer.from([0x44, 0x89, 0x88]))
    expect(at).toBeGreaterThan(0)
    // The scale is one millisecond: 12.5 s is 12500.
    expect(out.readDoubleBE(at + 3)).toBe(12_500)
    // Patching twice is refused: the field is there.
    expect(patchedHead(out, 20)).toBeNull()
  })

  it('leaves alone what is not laid out that way', () => {
    expect(patchedHead(Buffer.from('RIFF....WAVEfmt '), 5)).toBeNull()
    expect(patchedHead(Buffer.concat([ebml, tracks]), 5)).toBeNull()
    // A Segment with a known size would need that size rewritten too.
    expect(patchedHead(Buffer.concat([ebml, Buffer.from([0x18, 0x53, 0x80, 0x67, 0x90]), info, tracks]), 5)).toBeNull()
    expect(patchedHead(recording.subarray(0, 30), 5)).toBeNull()
  })

  it('rewrites the file in place', async () => {
    const file = fresh('mic.webm')
    writeFileSync(file, recording)
    expect(await patchWebmDuration(file, 3)).toBe(true)
    const out = readFileSync(file)
    expect(out.length).toBe(recording.length + 11 + 7)
    expect(out.subarray(out.length - cluster.length).equals(cluster)).toBe(true)
    expect(await patchWebmDuration(file, 3)).toBe(false)
    expect(await patchWebmDuration(file, 0)).toBe(false)
  })
})
