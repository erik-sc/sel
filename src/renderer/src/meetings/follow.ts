// While a meeting's audio plays, the paragraph of the transcript being heard is marked, and kept
// on screen for a reader who is following along. Through the CSS Custom Highlight API, as Find
// does: the editor's DOM is never touched. Part of the recording bar's chunk.
import { parseClockTime } from '@shared/meetings'

const HIGHLIGHT = 'meeting-now'
/** A time in a transcript is written as code; the editor draws that as a span carrying its marks, read-only views as a <code>. */
const STAMP = `[data-m*='"c"'], code`
/** Room kept above and below a paragraph brought into view: the top bar sits over the page. */
const MARGIN = 56

/**
 * Which paragraph is being heard at `time` (seconds): the one that starts latest at or before it.
 * Edited times may be out of order, so this is not a binary search. -1 before the first one.
 */
export function paragraphAt(starts: readonly number[], time: number): number {
  let found = -1
  for (let index = 0; index < starts.length; index++) {
    if (starts[index] <= time + 0.05 && (found < 0 || starts[index] >= starts[found])) found = index
  }
  return found
}

/** The rows of a page whose text begins with a time (`12:34`): the paragraphs of a transcript. */
export function stampedRows(root: ParentNode): { row: HTMLElement; start: number }[] {
  const rows: { row: HTMLElement; start: number }[] = []
  for (const row of root.querySelectorAll<HTMLElement>('.pe-body .blk[data-block-id] > .blk-row')) {
    const stamp = row.querySelector(STAMP)?.textContent?.trim() ?? ''
    const start = stamp ? parseClockTime(stamp) : null
    if (start !== null && row.textContent?.trimStart().startsWith(stamp)) rows.push({ row, start })
  }
  return rows
}

const canHighlight = (): boolean => typeof Highlight === 'function' && typeof CSS !== 'undefined' && 'highlights' in CSS
const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * Follows the player through the transcript of one page. `at` is told the time as it moves;
 * `stop` takes the mark away (the bar is gone).
 */
export class TranscriptFollower {
  private row: HTMLElement | null = null

  constructor(private readonly root: () => Element | null) {}

  at(time: number): void {
    const root = this.root()
    if (!root || !canHighlight()) return
    const rows = stampedRows(root)
    const next = rows[paragraphAt(rows.map((entry) => entry.start), time)]?.row ?? null
    if (next === this.row && CSS.highlights.has(HIGHLIGHT)) return
    const previous = this.row
    this.row = next
    if (!next) {
      CSS.highlights.delete(HIGHLIGHT)
      return
    }
    const range = document.createRange()
    range.selectNodeContents(next)
    CSS.highlights.set(HIGHLIGHT, new Highlight(range))
    if (previous?.isConnected && previous !== next) keepInView(previous, next)
  }

  stop(): void {
    this.row = null
    if (canHighlight()) CSS.highlights.delete(HIGHLIGHT)
  }
}

/** What scrolls the page a row is in (the editor's root in a tab, something else in other places). */
function scrollerOf(element: HTMLElement): Element | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && at.scrollHeight > at.clientHeight) return at
  }
  return null
}

/** Brings the next paragraph into view, but only for a reader who was looking at the one before. */
function keepInView(previous: HTMLElement, next: HTMLElement): void {
  const scroller = scrollerOf(next)
  if (!scroller) return
  const bounds = scroller.getBoundingClientRect()
  const was = previous.getBoundingClientRect()
  // Reading somewhere else on the page: they are left there.
  if (was.bottom <= bounds.top + MARGIN || was.top >= bounds.bottom) return
  const rect = next.getBoundingClientRect()
  if (rect.top >= bounds.top + MARGIN && rect.bottom <= bounds.bottom - MARGIN / 2) return
  scroller.scrollBy({ top: rect.top - bounds.top - bounds.height / 3, behavior: reducedMotion() ? 'auto' : 'smooth' })
}
