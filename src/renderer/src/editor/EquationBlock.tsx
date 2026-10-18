// An equation block: display math written in LaTeX and drawn by KaTeX, the engine of LaTeX
// documents. It shows the formula; a click (or arriving with the arrow keys) opens its TeX right
// below, and the formula is redrawn as it is typed. The TeX is `props.title`, plain like code.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { Block } from '@shared/types'
import { getBlock } from '@/store/blocks'
import { mathCache, useMathEngine } from '@/latex/katex'
import { useLatexLocale } from '@/latex/locale'
import { renderMath } from '@/latex/math'
import { LATEX_COPY, diagnosticMessage } from '@/latex/words'
import { useEditor } from './context'
import { textOf } from './richtext-dom'
import { TEXT_DEBOUNCE_MS, type Sel } from './types'
import './equation.css'

const INDENT = '  '
/** \label means nothing outside a document; KaTeX would refuse it. */
const LABEL_RE = /\\label\s*\{[^{}]*\}/g

export function EquationBlock({ block }: { block: Block }): JSX.Element {
  const { ctrl } = useEditor()
  const id = block.id
  const model = textOf(block.props.title)
  const [draft, setDraft] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const st = useRef({ draft: null as string | null, timer: 0, before: null as Sel, last: null as Sel })
  const value = draft ?? model
  const engine = useMathEngine()
  const locale = useLatexLocale()
  const copy = LATEX_COPY[locale]

  const outcome = useMemo(
    () => (engine && value.trim() ? renderMath(engine, value.replace(LABEL_RE, ''), true, {}, mathCache) : null),
    [engine, value]
  )
  const problem = outcome?.problem
    ? outcome.problem.kind === 'unsupported'
      ? diagnosticMessage(locale, 'math-unsupported', [outcome.problem.detail])
      : diagnosticMessage(locale, 'math-error', [outcome.problem.detail.replace(/^KaTeX parse error: /, '')])
    : null

  const flush = useCallback(() => {
    const s = st.current
    if (s.timer) window.clearTimeout(s.timer)
    s.timer = 0
    const text = s.draft
    if (text === null) return
    s.draft = null
    setDraft(null)
    const b = getBlock(id)
    if (!b || textOf(b.props.title) === text) return
    ctrl.commit([{ op: 'update', id, patch: { props: { title: text ? [[text]] : [] } } }], {
      before: s.before,
      after: s.last ?? s.before,
      key: `text:${id}`,
      silent: true
    })
  }, [id, ctrl])

  const onDraft = (text: string): void => {
    const s = st.current
    if (s.draft === null) s.before = s.last
    s.draft = text
    setDraft(text)
    const ta = ref.current
    if (ta) s.last = { kind: 'text', blockId: id, start: ta.selectionStart, end: ta.selectionEnd }
    if (s.timer) window.clearTimeout(s.timer)
    s.timer = window.setTimeout(flush, TEXT_DEBOUNCE_MS)
  }

  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta || !editing) return
    ta.style.height = '0px'
    ta.style.height = `${ta.scrollHeight}px`
  }, [value, editing])

  useEffect(() => {
    const ta = ref.current
    if (!ta) return
    const s = st.current
    const unregister = ctrl.register(id, {
      el: ta,
      rich: false,
      flush,
      sync() {
        if (s.timer) window.clearTimeout(s.timer)
        s.timer = 0
        s.draft = null
        setDraft(null)
      },
      getSel: () => ({ start: ta.selectionStart, end: ta.selectionEnd }),
      setSel(start, end) {
        ta.focus({ preventScroll: true })
        const len = ta.value.length
        ta.setSelectionRange(Math.min(start, len), Math.min(end, len))
      },
      focusAt(_x, edge) {
        ta.focus({ preventScroll: true })
        const p = edge === 'top' ? 0 : ta.value.length
        ta.setSelectionRange(p, p)
      }
    })
    return () => {
      flush()
      unregister()
    }
  }, [ctrl, id, flush])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const ta = e.currentTarget
    if (e.nativeEvent.isComposing) return
    const mod = e.ctrlKey || e.metaKey
    const { selectionStart: a, selectionEnd: b } = ta
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault()
      ta.setRangeText(INDENT, a, b, 'end')
      onDraft(ta.value)
    } else if (e.key === 'Enter' && (mod || e.shiftKey)) {
      // Done with the formula: on to a new paragraph below.
      e.preventDefault()
      flush()
      ctrl.insertAfter(id, 'text')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      flush()
      ctrl.selectBlocks([id])
    } else if (e.key === 'Backspace' && ta.value === '') {
      e.preventDefault()
      ctrl.turnInto([id], 'text')
    } else if (e.key === 'ArrowUp' && a === b && !e.shiftKey && !ta.value.slice(0, a).includes('\n')) {
      if (ctrl.moveVertical(id, -1, null)) e.preventDefault()
    } else if (e.key === 'ArrowDown' && a === b && !e.shiftKey && !ta.value.slice(b).includes('\n')) {
      if (ctrl.moveVertical(id, 1, null)) e.preventDefault()
    } else if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      ctrl.moveBlocks([id], e.key === 'ArrowUp' ? -1 : 1)
    }
  }

  const open = (): void => {
    const ta = ref.current
    if (!ta) return
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }

  return (
    <div className={`blk-equation-box${editing ? ' is-editing' : ''}`}>
      <div
        className="blk-equation-view"
        role="button"
        tabIndex={-1}
        aria-label={copy.equationLabel}
        onMouseDown={(e) => {
          e.preventDefault()
          open()
        }}
      >
        {outcome ? (
          <div className={`blk-equation-math${problem ? ' has-problem' : ''}`} dangerouslySetInnerHTML={{ __html: outcome.html }} />
        ) : value.trim() ? (
          <code className="blk-equation-source">{value}</code>
        ) : (
          <span className="blk-equation-empty">
            <span className="blk-equation-glyph" aria-hidden="true">
              {'√'}x
            </span>
            {copy.equationEmpty}
          </span>
        )}
      </div>
      <div className="blk-equation-editor">
        <textarea
          ref={ref}
          className="blk-equation-input"
          value={value}
          placeholder={copy.equationPlaceholder}
          aria-label={copy.equationLabel}
          spellCheck={false}
          rows={1}
          onChange={(e) => onDraft(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            flush()
            setEditing(false)
          }}
          onKeyDown={onKeyDown}
          onSelect={(e) => {
            st.current.last = { kind: 'text', blockId: id, start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }
          }}
        />
        {problem && editing && <div className="blk-equation-problem">{problem}</div>}
      </div>
    </div>
  )
}
