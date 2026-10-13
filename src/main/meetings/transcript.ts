import { clockTime, type MeetingStream } from '../../shared/meetings'
import type { RichText } from '../../shared/types'

/**
 * From what the transcription program returned for each stream to the transcript a person
 * reads. Pure (unit-tested).
 *
 * The two streams were recorded separately, so who is speaking needs no guessing: the
 * microphone is the note-taker ("Me"), the computer's audio is everybody else ("Others").
 */

export interface Segment {
  /** Seconds from the start of the recording. */
  start: number
  end: number
  text: string
}

export interface Paragraph {
  stream: MeetingStream
  start: number
  end: number
  text: string
}

/** What whisper writes for sound that is not speech: "[BLANK_AUDIO]", "(music)", "♪", "*sighs*". */
const NON_SPEECH_RE = /^(?:\s*(?:\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫\-–—.…,!?]+)\s*)+$/u
/** Sentences the model invents over silence, in the languages it mostly meets here. */
const HALLUCINATIONS: ReadonlySet<string> = new Set(
  [
    'thank you',
    'thanks for watching',
    'thank you for watching',
    'thanks for watching!',
    'subtitles by the amara.org community',
    'legendas pela comunidade amara.org',
    'obrigado',
    'obrigado por assistir',
    'e aí',
    'tchau',
    'you',
    'bye',
    'gracias',
    'subtítulos realizados por la comunidad de amara.org',
    'sous-titres réalisés par la communauté d\'amara.org',
    'untertitel im auftrag des zdf für funk, 2017'
  ].map(normalise)
)

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,!?…"'“”‘’]+/gu, ' ')
    .trim()
}

/** How many times in a row the same sentence may come before the rest is taken for a loop. */
const MAX_REPEATS = 2
/** A lone stock phrase is only dropped when it stands by itself this long before and after (seconds). */
const ISOLATION_S = 8

/**
 * Drops what is not speech: empty segments, markers like [BLANK_AUDIO], a sentence repeated
 * over and over (the model looping on silence or noise) and the stock phrases it invents for
 * silence when they stand alone. Keeps the order; fixes impossible times.
 */
export function cleanSegments(segments: readonly Segment[]): Segment[] {
  const sane: Segment[] = []
  for (const segment of segments) {
    if (!segment || typeof segment.text !== 'string') continue
    const text = segment.text.replace(/\s+/g, ' ').trim()
    if (!text || NON_SPEECH_RE.test(text)) continue
    const start = Number.isFinite(segment.start) && segment.start > 0 ? segment.start : 0
    const end = Number.isFinite(segment.end) && segment.end > start ? segment.end : start
    sane.push({ start, end, text })
  }
  sane.sort((a, b) => a.start - b.start)

  const out: Segment[] = []
  let run = 0
  for (let index = 0; index < sane.length; index++) {
    const segment = sane[index]
    const key = normalise(segment.text)
    const previous = out[out.length - 1]
    run = previous && normalise(previous.text) === key ? run + 1 : 1
    if (run > MAX_REPEATS) continue
    if (HALLUCINATIONS.has(key)) {
      const before = previous ? segment.start - previous.end : Infinity
      const next = sane[index + 1]
      const after = next ? next.start - segment.end : Infinity
      if (before >= ISOLATION_S && after >= ISOLATION_S) continue
    }
    out.push(segment)
  }
  return out
}

/** A new paragraph starts when the same speaker pauses this long (seconds), or has gone on this long. */
const PARAGRAPH_GAP_S = 20
const PARAGRAPH_MAX_CHARS = 900

/**
 * One transcript out of the two streams: segments in the order they were said, consecutive
 * ones of the same speaker joined into a paragraph that carries the time it starts.
 */
export function mergeTranscript(mic: readonly Segment[], system: readonly Segment[]): Paragraph[] {
  const all: Paragraph[] = [
    ...cleanSegments(mic).map((segment): Paragraph => ({ stream: 'mic', ...segment })),
    ...cleanSegments(system).map((segment): Paragraph => ({ stream: 'system', ...segment }))
  ]
  // Ties go to the microphone: a stable order for segments that start together.
  all.sort((a, b) => a.start - b.start || (a.stream === b.stream ? 0 : a.stream === 'mic' ? -1 : 1))
  const out: Paragraph[] = []
  for (const piece of all) {
    const last = out[out.length - 1]
    if (last && last.stream === piece.stream && piece.start - last.end < PARAGRAPH_GAP_S && last.text.length + piece.text.length < PARAGRAPH_MAX_CHARS) {
      last.text = `${last.text} ${piece.text}`
      last.end = Math.max(last.end, piece.end)
    } else out.push({ ...piece })
  }
  return out
}

export interface Speakers {
  mic: string
  system: string
}

export const DEFAULT_SPEAKERS: Speakers = { mic: 'Me', system: 'Others' }

/** A speaker's name as it may be stored and shown: one short line. */
export function cleanSpeaker(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/[:*`[\]]/g, '').trim().slice(0, 40)
  return name || fallback
}

/** A paragraph as the title of a text block: `12:34` in code, the speaker in bold, then the words. */
export function paragraphSpans(paragraph: Paragraph, speakers: Speakers): RichText {
  return [[clockTime(paragraph.start), [['c']]], [' '], [speakers[paragraph.stream], [['b']]], [`: ${paragraph.text}`]]
}

/** The transcript as plain lines, for the model: `[12:34] Me: …`. */
export function transcriptText(paragraphs: readonly Paragraph[], speakers: Speakers): string {
  return paragraphs.map((paragraph) => `[${clockTime(paragraph.start)}] ${speakers[paragraph.stream]}: ${paragraph.text}`).join('\n')
}

/** The same lines read back from the blocks of a transcript page (which the user may have edited). */
export function transcriptFromTitles(titles: readonly (RichText | undefined)[]): string {
  const lines: string[] = []
  for (const title of titles) {
    if (!title?.length) continue
    const first = title[0]
    const timed = first[1]?.some((mark) => mark[0] === 'c') === true
    const rest = (timed ? title.slice(1) : title).map((span) => span[0]).join('').trim()
    if (rest) lines.push(timed ? `[${first[0]}] ${rest}` : rest)
  }
  return lines.join('\n')
}

/** Replaces a speaker's name in a paragraph block written by `paragraphSpans`; null when it is not one. */
export function renameSpeakerSpans(title: RichText | undefined, from: string, to: string): RichText | null {
  if (!title || title.length < 3 || from === to) return null
  const index = title.findIndex((span, position) => position <= 2 && span[0] === from && span[1]?.some((mark) => mark[0] === 'b') === true)
  if (index < 0) return null
  return title.map((span, position) => (position === index ? [to, span[1]] : span)) as RichText
}
