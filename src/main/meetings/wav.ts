import { closeSync, fstatSync, ftruncateSync, openSync, readSync, writeSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { PCM } from '../../shared/meetings'

/**
 * The WAV files a recording is written to: one mono, 16 kHz, 16-bit stream each. Free of
 * Electron imports (unit-tested).
 *
 * A file starts with a 44-byte header whose two length fields can only be known at the end.
 * While recording they hold placeholders and the samples are appended as they arrive, so a
 * crash loses nothing that reached the disk: `repairWav` fills the lengths in from the size of
 * the file, on stop and when an interrupted recording is recovered.
 */

export const WAV_HEADER_BYTES = 44
/** A WAV length field is 32 bits; the 4-hour limit keeps a stream under 500 MB. */
export const WAV_MAX_DATA_BYTES = 0xffff_ffff - WAV_HEADER_BYTES

/** The header of a PCM file with `dataBytes` of samples. */
export function wavHeader(dataBytes: number, sampleRate: number = PCM.sampleRate): Buffer {
  const header = Buffer.alloc(WAV_HEADER_BYTES)
  const size = Math.max(0, Math.min(WAV_MAX_DATA_BYTES, Math.floor(dataBytes)))
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + size, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // the fmt chunk is 16 bytes
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * PCM.bytesPerSample, 28) // bytes per second
  header.writeUInt16LE(PCM.bytesPerSample, 32) // block align
  header.writeUInt16LE(PCM.bytesPerSample * 8, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(size, 40)
  return header
}

export interface WavInfo {
  sampleRate: number
  dataBytes: number
  seconds: number
}

/** Reads a header this module wrote. Null for anything else. */
export function parseWavHeader(header: Uint8Array): { sampleRate: number; dataBytes: number } | null {
  if (header.byteLength < WAV_HEADER_BYTES) return null
  const view = Buffer.from(header.buffer, header.byteOffset, header.byteLength)
  if (view.toString('ascii', 0, 4) !== 'RIFF' || view.toString('ascii', 8, 12) !== 'WAVE') return null
  if (view.toString('ascii', 12, 16) !== 'fmt ' || view.toString('ascii', 36, 40) !== 'data') return null
  if (view.readUInt16LE(20) !== 1 || view.readUInt16LE(22) !== 1 || view.readUInt16LE(34) !== 16) return null
  return { sampleRate: view.readUInt32LE(24), dataBytes: view.readUInt32LE(40) }
}

/**
 * Appends samples to one file. Synchronous writes on purpose: a batch is a few kilobytes ten
 * times a second, and a write that has returned is with the operating system even if this
 * process dies in the next instant.
 */
export class WavWriter {
  private fd: number | null
  private written = 0

  constructor(
    readonly file: string,
    private readonly maxDataBytes: number = WAV_MAX_DATA_BYTES
  ) {
    // 'wx': a recording never writes over a file that is already there.
    this.fd = openSync(file, 'wx')
    writeSync(this.fd, wavHeader(0))
  }

  get dataBytes(): number {
    return this.written
  }

  get seconds(): number {
    return this.written / PCM.bytesPerSample / PCM.sampleRate
  }

  /** Appends whole samples. Returns false (and writes nothing) when the file is closed or full. */
  append(samples: Uint8Array): boolean {
    if (this.fd === null || samples.byteLength % PCM.bytesPerSample !== 0) return false
    if (this.written + samples.byteLength > this.maxDataBytes) return false
    writeSync(this.fd, samples)
    this.written += samples.byteLength
    return true
  }

  /** Writes the real lengths into the header and closes the file. Safe to call twice. */
  close(): void {
    const fd = this.fd
    if (fd === null) return
    this.fd = null
    try {
      writeSync(fd, wavHeader(this.written), 0, WAV_HEADER_BYTES, 0)
    } finally {
      closeSync(fd)
    }
  }
}

/**
 * Makes a file left by a recording that never stopped a valid WAV: drops a half-written last
 * sample and writes the lengths the size of the file implies. Returns what it holds, or null
 * when it is not one of ours (the file is then left alone).
 */
export function repairWav(file: string): WavInfo | null {
  let fd: number
  try {
    fd = openSync(file, 'r+')
  } catch {
    return null
  }
  try {
    const size = fstatSync(fd).size
    const head = Buffer.alloc(WAV_HEADER_BYTES)
    if (size < WAV_HEADER_BYTES || readSync(fd, head, 0, WAV_HEADER_BYTES, 0) !== WAV_HEADER_BYTES) return null
    const parsed = parseWavHeader(head)
    if (!parsed || parsed.sampleRate !== PCM.sampleRate) return null
    let dataBytes = Math.min(size - WAV_HEADER_BYTES, WAV_MAX_DATA_BYTES)
    dataBytes -= dataBytes % PCM.bytesPerSample
    if (WAV_HEADER_BYTES + dataBytes !== size) ftruncateSync(fd, WAV_HEADER_BYTES + dataBytes)
    if (parsed.dataBytes !== dataBytes) writeSync(fd, wavHeader(dataBytes), 0, WAV_HEADER_BYTES, 0)
    return { sampleRate: parsed.sampleRate, dataBytes, seconds: dataBytes / PCM.bytesPerSample / PCM.sampleRate }
  } finally {
    closeSync(fd)
  }
}

/** What a finished file holds, without changing it. */
export async function readWavInfo(file: string): Promise<WavInfo | null> {
  let handle
  try {
    handle = await open(file, 'r')
  } catch {
    return null
  }
  try {
    const head = Buffer.alloc(WAV_HEADER_BYTES)
    const { bytesRead } = await handle.read(head, 0, WAV_HEADER_BYTES, 0)
    const parsed = bytesRead === WAV_HEADER_BYTES ? parseWavHeader(head) : null
    if (!parsed) return null
    const available = (await handle.stat()).size - WAV_HEADER_BYTES
    const dataBytes = Math.max(0, Math.min(parsed.dataBytes, available))
    return { sampleRate: parsed.sampleRate, dataBytes, seconds: dataBytes / PCM.bytesPerSample / parsed.sampleRate }
  } finally {
    await handle.close()
  }
}

/**
 * Copies `seconds` of a file starting at `fromSeconds` into a WAV of its own: one piece of a
 * long recording, for the transcription program. Returns the seconds it holds.
 */
export async function sliceWav(source: string, target: string, fromSeconds: number, seconds: number): Promise<number> {
  const info = await readWavInfo(source)
  if (!info) throw new Error('The recording could not be read.')
  const bytesPerSecond = info.sampleRate * PCM.bytesPerSample
  const start = Math.min(info.dataBytes, Math.floor(fromSeconds * info.sampleRate) * PCM.bytesPerSample)
  const length = Math.min(info.dataBytes - start, Math.floor(seconds * info.sampleRate) * PCM.bytesPerSample)
  const input = await open(source, 'r')
  const output = await open(target, 'w')
  try {
    await output.write(wavHeader(length, info.sampleRate))
    const buffer = Buffer.alloc(1024 * 1024)
    let done = 0
    while (done < length) {
      const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, length - done), WAV_HEADER_BYTES + start + done)
      if (bytesRead === 0) break
      await output.write(buffer, 0, bytesRead)
      done += bytesRead
    }
  } finally {
    await input.close()
    await output.close()
  }
  return length / bytesPerSecond
}

/** The loudest sample of a batch, 0–1. */
export function peakOf(samples: Uint8Array): number {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength - (samples.byteLength % 2))
  let peak = 0
  // Every fourth sample is plenty to tell speech from silence.
  for (let offset = 0; offset < view.byteLength; offset += 8) {
    const value = Math.abs(view.getInt16(offset, true))
    if (value > peak) peak = value
  }
  return peak / 32768
}
