// Find in page (Ctrl+F): a small bar at the top right of the content that marks every match on
// screen and walks through them. Matches are painted with the CSS Custom Highlight API, so the
// page's DOM, and the editor working in it, are never touched. The matching itself is pure and
// lives in ./findInPage.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { IconButton } from '@/ui/Button'
import { ChevronDown, ChevronUp, Close, Search } from '@/ui/icons'
import { describeCount, findInSegments, keepIndex, stepIndex } from './findInPage'
import { closeFind, setFindQuery, useFind } from './findStore'
import './find.css'

const HIGHLIGHT = 'sel-find'
const HIGHLIGHT_CURRENT = 'sel-find-current'

/** Text in these is not part of the page: the bar itself, Herman, anything marked to be skipped. */
const SKIP =
  '.find-bar, .herman-dock, [data-find-skip], [aria-hidden="true"], [hidden], script, style, template, select, option, datalist'

/** Elements that only format text: a run of text goes on through them. */
const INLINE = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DEL', 'DFN', 'EM', 'I', 'INS', 'KBD',
  'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR'
])

function searchRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main.content')
}

/** The visible text under `root`, as runs of text nodes (one run per line, cell or label). */
function collectRuns(root: HTMLElement): Text[][] {
  const runs: Text[][] = []
  const visible = new Map<Element, boolean>()
  let run: Text[] = []
  let owner: Element | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element) return node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    }
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const parent = text.parentElement
    if (!parent) continue
    let shown = visible.get(parent)
    if (shown === undefined) {
      shown = typeof parent.checkVisibility === 'function' ? parent.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true
      visible.set(parent, shown)
    }
    if (!shown) continue
    let block: Element = parent
    while (block !== root && INLINE.has(block.tagName) && block.parentElement) block = block.parentElement
    if (block !== owner && run.length) {
      runs.push(run)
      run = []
    }
    owner = block
    run.push(text)
  }
  if (run.length) runs.push(run)
  return runs
}

function findRanges(query: string): Range[] {
  const root = searchRoot()
  if (!root) return []
  const runs = collectRuns(root)
  const found = findInSegments(
    runs.map((nodes) => nodes.map((node) => node.data)),
    query
  )
  return found.map((match) => {
    const nodes = runs[match.segment]
    const range = document.createRange()
    range.setStart(nodes[match.start.node], match.start.offset)
    range.setEnd(nodes[match.end.node], match.end.offset)
    return range
  })
}

const canHighlight = (): boolean => typeof Highlight === 'function' && typeof CSS !== 'undefined' && 'highlights' in CSS

function paint(ranges: Range[], current: number): void {
  if (!canHighlight()) return
  if (ranges.length === 0) {
    CSS.highlights.delete(HIGHLIGHT)
    CSS.highlights.delete(HIGHLIGHT_CURRENT)
    return
  }
  CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges))
  const active = ranges[current]
  if (active) {
    const highlight = new Highlight(active)
    highlight.priority = 1
    CSS.highlights.set(HIGHLIGHT_CURRENT, highlight)
  } else {
    CSS.highlights.delete(HIGHLIGHT_CURRENT)
  }
}

function clearPaint(): void {
  if (!canHighlight()) return
  CSS.highlights.delete(HIGHLIGHT)
  CSS.highlights.delete(HIGHLIGHT_CURRENT)
}

/** Room kept above and below a match brought into view: the bar sits over the top of the page. */
const REVEAL_MARGIN = 56

function inView(rect: DOMRect, bounds: DOMRect): boolean {
  return (
    rect.height > 0 &&
    rect.top >= bounds.top + REVEAL_MARGIN &&
    rect.bottom <= bounds.bottom - REVEAL_MARGIN / 2 &&
    rect.left >= bounds.left &&
    rect.right <= bounds.right
  )
}

/** Scrolls a match into view unless it is already well inside it. */
function reveal(range: Range): void {
  const element = range.startContainer.parentElement
  const scroller = element?.closest('.page-scroll') ?? searchRoot()
  if (!element || !scroller) return
  if (inView(range.getBoundingClientRect(), scroller.getBoundingClientRect())) return
  // First whatever scrolls inside the page (a wide table, a long code block), then the page
  // itself, centring the match rather than its block, which may be taller than the view.
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const rect = range.getBoundingClientRect()
  const bounds = scroller.getBoundingClientRect()
  if (!inView(rect, bounds)) scroller.scrollBy({ top: rect.top - bounds.top - bounds.height / 2 + rect.height / 2 })
}

/** The first match that is on screen or below it: where a new search starts, as in a browser. */
function firstFromView(ranges: Range[]): number {
  if (ranges.length === 0) return -1
  const top = searchRoot()?.getBoundingClientRect().top ?? 0
  const index = ranges.findIndex((range) => range.getBoundingClientRect().bottom >= top)
  return index < 0 ? 0 : index
}

/** Mounted by the shell inside the content area; renders nothing while closed. */
export function FindBar() {
  const open = useFind((state) => state.open)
  return open ? <OpenFindBar /> : null
}

function OpenFindBar() {
  const query = useFind((state) => state.query)
  const nonce = useFind((state) => state.nonce)
  const barRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rangesRef = useRef<Range[]>([])
  const indexRef = useRef(-1)
  const [result, setResult] = useState({ index: -1, total: 0 })

  const show = useCallback((ranges: Range[], index: number, scroll: boolean) => {
    rangesRef.current = ranges
    indexRef.current = index
    paint(ranges, index)
    setResult({ index, total: ranges.length })
    if (scroll && ranges[index]) reveal(ranges[index])
  }, [])

  // On close, hand focus back: to the current match when it is in text that can be edited (so
  // Escape leaves you at the word you were looking for), else to wherever it was before.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      clearPaint()
      // Still on screen: not a close but React trying the effect twice (StrictMode, in development).
      if (barRef.current?.isConnected) return
      if (document.activeElement?.closest('[role="dialog"]')) return
      if (!document.activeElement?.closest('.find-bar') && document.activeElement !== document.body) return
      const current = rangesRef.current[indexRef.current]
      if (current && !current.collapsed && selectMatch(current)) return
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  // Every Ctrl+F: focus the field with its text selected, ready to be typed over.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [nonce])

  // A new query starts from the first match in view. Briefly held back while typing: each
  // search walks the whole page.
  useEffect(() => {
    const run = (): void => {
      const ranges = findRanges(query)
      show(ranges, firstFromView(ranges), true)
    }
    if (!query) {
      run()
      return
    }
    const timer = setTimeout(run, 60)
    return () => clearTimeout(timer)
  }, [query, show])

  // The page changes under the bar (typing, another tab, a row added): find again, stay put.
  useEffect(() => {
    const root = searchRoot()
    if (!root) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let waitingSince = 0
    const refind = (): void => {
      timer = undefined
      const query = useFind.getState().query
      if (!query) return
      const ranges = findRanges(query)
      show(ranges, keepIndex(indexRef.current, ranges.length), false)
    }
    const observer = new MutationObserver((records) => {
      if (records.every((record) => isSkipped(record.target))) return
      // Wait for a quiet moment, but never let a page that keeps changing put it off for long.
      if (timer === undefined) waitingSince = Date.now()
      clearTimeout(timer)
      if (Date.now() - waitingSince > 500) refind()
      else timer = setTimeout(refind, 150)
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true })
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [show])

  const step = (direction: 1 | -1): void => {
    let ranges = rangesRef.current
    let from = indexRef.current
    // The text under the matches was replaced before the search could run again: run it now.
    if (ranges.some((range) => range.collapsed)) {
      ranges = findRanges(useFind.getState().query)
      from = keepIndex(from, ranges.length)
    }
    show(ranges, stepIndex(from, ranges.length, direction), true)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' || event.key === 'F3') {
      event.preventDefault()
      event.stopPropagation()
      step(event.shiftKey ? -1 : 1)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeFind()
    }
  }

  const count = describeCount(result.index, result.total, query)
  const none = result.total === 0

  return (
    <div ref={barRef} className="find-bar" role="search" aria-label="Find" onKeyDown={onKeyDown}>
      <Search size={14} className="find-bar-icon" />
      <input
        ref={inputRef}
        className="find-bar-input"
        value={query}
        onChange={(event) => setFindQuery(event.target.value)}
        placeholder="Find in page"
        aria-label="Find in page"
        spellCheck={false}
        autoComplete="off"
      />
      <span className={`find-bar-count${none && count ? ' is-empty' : ''}`} aria-live="polite">
        {count}
      </span>
      <IconButton size="small" label="Previous match" shortcut="Shift+Enter" disabled={none} onClick={() => step(-1)}>
        <ChevronUp size={14} />
      </IconButton>
      <IconButton size="small" label="Next match" shortcut="Enter" disabled={none} onClick={() => step(1)}>
        <ChevronDown size={14} />
      </IconButton>
      <IconButton size="small" label="Close" shortcut="Esc" onClick={closeFind}>
        <Close size={14} />
      </IconButton>
    </div>
  )
}

/** Puts the caret on a match inside editable text, selecting it. False when it is not editable. */
function selectMatch(range: Range): boolean {
  const start = range.startContainer
  if (!start.isConnected || !range.endContainer.isConnected) return false
  const editable = start.parentElement?.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])')
  if (!editable || !editable.contains(range.endContainer)) return false
  editable.focus({ preventScroll: true })
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range.cloneRange())
  return true
}

/** A change in text that is not searched (the bar's own count, Herman talking) needs no new search. */
function isSkipped(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement
  return !!element?.closest(SKIP)
}
