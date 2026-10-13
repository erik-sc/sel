import { TRANSCRIPT_TITLE } from '../../shared/meetings'
import { plainText } from '../../shared/richtext'
import type { AiLanguage } from '../../shared/ai'
import type { Block } from '../../shared/types'
import { transcriptFromTitles } from '../meetings/transcript'
import { buildCondensePrompt, PROMPT_CAPS, type MeetingPromptData } from './prompts'

/**
 * What "Write up notes" hands to the model, read in the main process from what is stored: the
 * window names a page and nothing else. Free of Electron imports (unit-tested).
 */

export interface MeetingSource {
  get(id: string): Block | null
  children(id: string): Block[]
  blocksToMarkdown(blocks: Block[]): string
}

/**
 * The transcript and the notes of a meeting page: the child page "Transcript" as lines of
 * `[time] Speaker: words`, and every other block of the page as the note-taker's notes.
 * Null when the page has no transcript (yet).
 */
export function loadMeeting(source: MeetingSource, pageId: string): MeetingPromptData | null {
  const page = source.get(pageId)
  if (!page || page.type !== 'page') return null
  const children = source.children(pageId)
  const transcriptPage = children.find((child) => child.type === 'page' && child.trashedAt === null && plainText(child.props.title).trim() === TRANSCRIPT_TITLE)
  if (!transcriptPage) return null
  const transcript = transcriptFromTitles(source.children(transcriptPage.id).map((block) => block.props.title))
  if (!transcript.trim()) return null
  const data: MeetingPromptData = { transcript }
  const title = plainText(page.props.title).trim()
  if (title) data.title = title
  // The row's properties, by the ids the Meetings database is created with.
  const values = page.props.values ?? {}
  const date = values['date']
  if (date && typeof date === 'object' && !Array.isArray(date) && typeof date.start === 'string') data.date = date.start
  if (typeof values['attendees'] === 'string' && values['attendees'].trim()) data.attendees = values['attendees'].trim()
  const own = children.filter((child) => child.type !== 'page' && child.type !== 'database' && child.trashedAt === null)
  const notes = own.length ? source.blocksToMarkdown(own).trim() : ''
  if (notes) data.notes = notes
  return data
}

/** Characters of transcript one condensing request takes. */
export const CONDENSE_PART_CHARS = 100_000
/** A meeting cannot be cut into more requests than this; what is beyond is left out, and said so. */
export const CONDENSE_MAX_PARTS = 12

/** Cuts a transcript into parts of at most `max` characters, between lines wherever it can. */
export function splitTranscript(text: string, max: number = CONDENSE_PART_CHARS): string[] {
  const parts: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    // A single line longer than a part is cut where it must be.
    const pieces: string[] = []
    for (let at = 0; at < Math.max(1, line.length); at += max) pieces.push(line.slice(at, at + max))
    for (const piece of pieces) {
      if (current && current.length + 1 + piece.length > max) {
        parts.push(current)
        current = ''
      }
      current = current ? `${current}\n${piece}` : piece
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

/**
 * A transcript that fits one prompt is used as it is. A longer one is condensed first, part
 * after part, each by a request of its own through `run` (sequential: one at a time, in
 * order), and the notes of the parts stand in for it. `signal` stops between parts.
 */
export async function prepareMeeting(
  data: MeetingPromptData,
  language: AiLanguage | 'auto',
  run: (prompt: string) => Promise<string>,
  signal?: AbortSignal,
  caps: { transcript: number; part: number } = { transcript: PROMPT_CAPS.transcript, part: CONDENSE_PART_CHARS }
): Promise<MeetingPromptData> {
  if (data.transcript.length <= caps.transcript) return data
  const all = splitTranscript(data.transcript, caps.part)
  const parts = all.slice(0, CONDENSE_MAX_PARTS)
  const notes: string[] = []
  for (const [index, part] of parts.entries()) {
    if (signal?.aborted) throw new Error('Cancelled')
    const text = (await run(buildCondensePrompt(part, index, parts.length, { defaultLanguage: language }))).trim()
    if (text) notes.push(`Part ${index + 1} of ${parts.length}:\n${text}`)
  }
  if (!notes.length) throw new Error('The transcript could not be condensed.')
  if (all.length > parts.length) notes.push(`(The meeting went on after this; ${all.length - parts.length} more parts of the transcript were left out.)`)
  return { ...data, transcript: notes.join('\n\n'), condensed: true }
}
