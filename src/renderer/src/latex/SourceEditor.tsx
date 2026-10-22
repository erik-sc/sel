// The source side of a LaTeX document: a plain textarea over a coloured copy of its text, with
// line numbers, the lines that have problems marked, auto-closing pairs and a find bar. The
// textarea keeps its own undo stack: every edit made by a key goes through execCommand.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { findMatches } from '@/shell/findInPage'
import { IconButton } from '@/ui/Button'
import { ChevronDown, ChevronUp, Close } from '@/ui/icons'
import type { LatexDiagnostic } from './convert'
import { backspacePair, enter, indent, lineAt, lineRange, typePair, type Edit } from './editing'
import { highlightLines, markLines } from './highlight'
import type { LatexCopy } from './words'

export interface SourceEditorHandle {
  getValue(): string
  /** Replaces the whole text (a change made elsewhere); the undo stack starts again. */
  setValue(text: string): void
  focus(): void
  goToLine(line: number): void
  openFind(): void
  /** The line at the top of the view, with the fraction of it scrolled past. */
  topLine(): number
  scrollToLine(line: number): void
  scroller(): HTMLDivElement | null
}

interface Props {
  initial: string
  copy: LatexCopy
  diagnostics: readonly LatexDiagnostic[]
  readOnly?: boolean
  onInput(text: string): void
  onScroll(): void
}

function rowsHtml(lines: readonly string[], marks?: ReadonlyMap<number, string>): string {
  let html = ''
  for (let i = 0; i < lines.length; i++) {
    const mark = marks?.get(i + 1)
    html += `<div class="latex-row${mark ? ` has-${mark}` : ''}"><span class="latex-ln">${marks ? i + 1 : ''}</span><span class="latex-lc">${lines[i] || '​'}</span></div>`
  }
  return html
}

export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(
  { initial, copy, diagnostics, readOnly, onInput, onScroll },
  ref
): JSX.Element {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const findRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initial)
  const [find, setFind] = useState({ open: false, query: '', index: 0 })
  // After Escape, Tab leaves the editor instead of indenting (as in other code editors).
  const tabLeaves = useRef(false)

  const changed = useCallback(
    (value: string) => {
      setText(value)
      onInput(value)
    },
    [onInput]
  )

  const apply = useCallback(
    (edit: Edit | null): boolean => {
      const ta = taRef.current
      if (!edit || !ta) return false
      ta.setSelectionRange(edit.start, edit.end)
      if (edit.text || edit.start !== edit.end) {
        // execCommand keeps the edit on the textarea's undo stack and fires `input`.
        const done = document.execCommand(edit.text ? 'insertText' : 'delete', false, edit.text)
        if (!done) {
          ta.setRangeText(edit.text, edit.start, edit.end, 'end')
          changed(ta.value)
        }
      }
      ta.setSelectionRange(edit.caret, edit.caretEnd ?? edit.caret)
      return true
    },
    [changed]
  )

  const rows = (): HTMLCollection | undefined => layerRef.current?.children

  const scrollRowIntoView = (line: number, center: boolean): void => {
    const row = rows()?.[line - 1] as HTMLElement | undefined
    const scroller = scrollRef.current
    if (!row || !scroller) return
    const top = row.offsetTop
    const bottom = top + row.offsetHeight
    if (center) scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3)
    else if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight
  }

  const matches = useMemo(() => (find.open && find.query ? findMatches(text, find.query) : []), [text, find.open, find.query])
  const current = matches.length ? Math.min(find.index, matches.length - 1) : -1

  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the match itself changes, not on every keystroke elsewhere.
  useEffect(() => {
    if (current >= 0) scrollRowIntoView(lineAt(text, matches[current].start), true)
  }, [current, matches])

  const openFind = useCallback(() => {
    const ta = taRef.current
    const selected = ta && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : ''
    setFind((f) => ({ open: true, query: selected && !selected.includes('\n') ? selected : f.query, index: 0 }))
    requestAnimationFrame(() => {
      findRef.current?.focus()
      findRef.current?.select()
    })
  }, [])

  const closeFind = (select: boolean): void => {
    const ta = taRef.current
    if (select && ta && current >= 0) {
      ta.focus()
      ta.setSelectionRange(matches[current].start, matches[current].end)
    } else ta?.focus()
    setFind((f) => ({ ...f, open: false }))
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` and `scrollRowIntoView` only read refs.
  useImperativeHandle(
    ref,
    () => ({
      getValue: () => taRef.current?.value ?? text,
      setValue(value) {
        const ta = taRef.current
        if (!ta || ta.value === value) return
        const { selectionStart, selectionEnd } = ta
        ta.value = value
        ta.setSelectionRange(Math.min(selectionStart, value.length), Math.min(selectionEnd, value.length))
        setText(value)
      },
      focus: () => taRef.current?.focus({ preventScroll: true }),
      goToLine(line) {
        const ta = taRef.current
        if (!ta) return
        const range = lineRange(ta.value, line)
        ta.focus({ preventScroll: true })
        ta.setSelectionRange(range.start, range.end)
        scrollRowIntoView(line, true)
      },
      openFind,
      topLine() {
        const scroller = scrollRef.current
        const list = rows()
        if (!scroller || !list?.length) return 1
        const y = scroller.scrollTop
        let lo = 0
        let hi = list.length - 1
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if ((list[mid] as HTMLElement).offsetTop <= y) lo = mid
          else hi = mid - 1
        }
        const row = list[lo] as HTMLElement
        return lo + 1 + Math.min(1, Math.max(0, (y - row.offsetTop) / Math.max(1, row.offsetHeight)))
      },
      scrollToLine(line) {
        const scroller = scrollRef.current
        const list = rows()
        if (!scroller || !list?.length) return
        const index = Math.max(0, Math.min(list.length - 1, Math.floor(line) - 1))
        const row = list[index] as HTMLElement
        scroller.scrollTop = row.offsetTop + (line - Math.floor(line)) * row.offsetHeight
      },
      scroller: () => scrollRef.current
    }),
    [text, openFind]
  )

  const marks = useMemo(() => {
    const byLine = new Map<number, string>()
    for (const d of diagnostics) if (byLine.get(d.line) !== 'error') byLine.set(d.line, d.severity)
    return byLine
  }, [diagnostics])
  const lines = useMemo(() => highlightLines(text), [text])
  const layer = useMemo(() => rowsHtml(lines, marks), [lines, marks])
  const markLayer = useMemo(() => (matches.length ? rowsHtml(markLines(text, matches, current)) : ''), [text, matches, current])
  const digits = Math.max(2, String(lines.length).length)

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || readOnly) return
    const ta = e.currentTarget
    const { selectionStart: start, selectionEnd: end, value } = ta
    const mod = (e.ctrlKey && !e.altKey) || e.metaKey
    const leaving = tabLeaves.current
    tabLeaves.current = false
    if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey) {
      e.preventDefault()
      openFind()
    } else if (e.key === 'Escape') {
      tabLeaves.current = true
    } else if (e.key === 'Tab' && !mod && !e.altKey && !leaving) {
      e.preventDefault()
      apply(indent(value, start, end, e.shiftKey))
    } else if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      apply(enter(value, start, end))
    } else if (e.key === 'Backspace' && !mod) {
      if (apply(backspacePair(value, start, end))) e.preventDefault()
    } else if (e.key.length === 1 && !mod && !(e.altKey && !e.ctrlKey)) {
      // Ctrl+Alt is AltGr on Windows: `{` and `[` are typed that way on many layouts.
      const edit = typePair(value, start, end, e.key)
      if (edit) {
        e.preventDefault()
        apply(edit)
      }
    }
  }

  const step = (delta: number): void => {
    if (!matches.length) return
    setFind((f) => ({ ...f, index: (current + delta + matches.length) % matches.length }))
  }

  return (
    <div className="latex-editor">
      {find.open && (
        <div className="latex-find" role="search">
          <input
            ref={findRef}
            className="latex-find-input"
            value={find.query}
            placeholder={copy.findPlaceholder}
            aria-label={copy.find}
            spellCheck={false}
            onChange={(e) => setFind({ open: true, query: e.target.value, index: 0 })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                step(e.shiftKey ? -1 : 1)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeFind(true)
              }
            }}
          />
          <span className="latex-find-count" aria-live="polite">
            {find.query ? (matches.length ? copy.matches(current + 1, matches.length) : copy.noMatches) : ''}
          </span>
          <IconButton label={copy.findPrev} size="small" onClick={() => step(-1)} disabled={!matches.length}>
            <ChevronUp />
          </IconButton>
          <IconButton label={copy.findNext} size="small" onClick={() => step(1)} disabled={!matches.length}>
            <ChevronDown />
          </IconButton>
          <IconButton label={copy.findClose} size="small" onClick={() => closeFind(false)}>
            <Close />
          </IconButton>
        </div>
      )}
      <div className="latex-editor-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="latex-code" style={{ ['--latex-gutter' as string]: `calc(${digits}ch + 28px)` }}>
          {markLayer && <div className="latex-marks" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markLayer }} />}
          <div className="latex-layer" ref={layerRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: layer }} />
          <textarea
            ref={taRef}
            className="latex-input"
            defaultValue={initial}
            aria-label={copy.sourceLabel}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            readOnly={readOnly}
            wrap="soft"
            onInput={(e) => changed(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  )
})
