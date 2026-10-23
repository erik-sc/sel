/**
 * Incremental parser for the program's `stream-json` output: one JSON object per line, arriving
 * in chunks that split lines (and multi-byte characters: decode with a StringDecoder first)
 * anywhere. Lines that are not a JSON object are counted and skipped, never thrown on.
 */

/** A line longer than this is dropped while it streams, so one runaway line cannot fill memory. */
export const MAX_LINE_CHARS = 4 * 1024 * 1024

export class NdjsonParser {
  private buffer = ''
  /** True while the rest of an over-long line is being thrown away. */
  private skipping = false
  /** Lines that were not a JSON object (warnings, progress text...). */
  noise = 0
  /** Lines dropped for their length. */
  oversized = 0

  constructor(private readonly maxLineChars: number = MAX_LINE_CHARS) {}

  /** Feeds one decoded chunk; returns the objects completed by it, in order. */
  push(chunk: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = []
    let rest = chunk
    for (;;) {
      const newline = rest.indexOf('\n')
      if (newline < 0) break
      const piece = rest.slice(0, newline)
      rest = rest.slice(newline + 1)
      if (this.skipping) {
        // The end of a dropped line: the next one starts clean.
        this.skipping = false
        this.buffer = ''
        continue
      }
      if (this.buffer.length + piece.length > this.maxLineChars) {
        this.oversized++
        this.buffer = ''
        continue
      }
      const line = this.buffer + piece
      this.buffer = ''
      this.take(line, out)
    }
    if (this.skipping) return out
    if (this.buffer.length + rest.length > this.maxLineChars) {
      this.oversized++
      this.buffer = ''
      this.skipping = true
    } else this.buffer += rest
    return out
  }

  /** The stream ended: a last line without a newline still counts. */
  end(): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = []
    if (!this.skipping && this.buffer) this.take(this.buffer, out)
    this.buffer = ''
    this.skipping = false
    return out
  }

  private take(raw: string, out: Record<string, unknown>[]): void {
    const line = raw.trim()
    if (!line) return
    if (line[0] !== '{') {
      this.noise++
      return
    }
    try {
      const value: unknown = JSON.parse(line)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) out.push(value as Record<string, unknown>)
      else this.noise++
    } catch {
      this.noise++
    }
  }
}

// ---- what the events mean ----------------------------------------------------

export type StreamSignal =
  /** A piece of the answer. */
  | { kind: 'delta'; text: string }
  /** A whole assistant message (sent after its deltas; the only text when partial messages are off). */
  | { kind: 'message'; text: string }
  /** The last event: the complete answer, or what went wrong. */
  | { kind: 'result'; text: string; isError: boolean; subtype: string; costUsd?: number }
  | null

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function textBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const item of content) {
    const block = record(item)
    if (block && block['type'] === 'text' && typeof block['text'] === 'string') out += block['text']
  }
  return out
}

/**
 * Reads one stream-json event. The shapes handled are the ones the program emits in print mode:
 *   {"type":"system","subtype":"init",...}                                  ignored
 *   {"type":"stream_event","event":{"type":"content_block_delta",
 *        "delta":{"type":"text_delta","text":"..."}}}                       delta
 *   {"type":"assistant","message":{"content":[{"type":"text","text":".."}]}} message
 *   {"type":"result","subtype":"success","is_error":false,"result":"..."}   result
 * Anything else (thinking deltas, tool events, rate-limit notices, future types) is ignored.
 */
export function readEvent(event: Record<string, unknown>): StreamSignal {
  switch (event['type']) {
    case 'stream_event': {
      // Text produced by a sub-agent is not part of the answer.
      if (typeof event['parent_tool_use_id'] === 'string') return null
      const inner = record(event['event'])
      if (!inner || inner['type'] !== 'content_block_delta') return null
      const delta = record(inner['delta'])
      if (!delta || delta['type'] !== 'text_delta' || typeof delta['text'] !== 'string' || !delta['text']) return null
      return { kind: 'delta', text: delta['text'] }
    }
    case 'assistant': {
      if (typeof event['parent_tool_use_id'] === 'string') return null
      const text = textBlocks(record(event['message'])?.['content'])
      return text ? { kind: 'message', text } : null
    }
    case 'result': {
      const subtype = typeof event['subtype'] === 'string' ? event['subtype'] : ''
      const text = typeof event['result'] === 'string' ? event['result'] : ''
      const isError = event['is_error'] === true || (subtype !== '' && subtype !== 'success')
      // What the request cost, when the program says (C5): counted on this computer, shown in Settings → AI.
      const cost = event['total_cost_usd']
      return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
        ? { kind: 'result', text, isError, subtype, costUsd: cost }
        : { kind: 'result', text, isError, subtype }
    }
    default:
      return null
  }
}
