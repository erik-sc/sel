// The editor of a formula property: the expression (properties by name), suggestions for
// property and function names, the functions with a line of help each, and a live result
// for the first row. The logic (checking, preview, completions) is in logic/formula.ts.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { PropertySchema } from '@shared/types'
import { Button } from '@/ui/Button'
import * as L from './logic'
import * as actions from './actions'
import { TypeIcon } from './common'
import { useCommitOnUnmount, useEscapePressed } from './hooks'
import { useRelated } from './related'

function PreviewLine({
  preview,
  text,
  rowTitle,
  onShow
}: {
  preview: L.FormulaPreview
  text: string
  rowTitle: string | null
  onShow: (problem: L.FormulaProblem) => void
}): JSX.Element {
  const { problem, outcome, type } = preview
  if (problem) {
    return (
      <button
        type="button"
        className="db-formula-status is-error"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onShow(problem)}
      >
        <span className="db-formula-error-mark" aria-hidden="true">
          !
        </span>
        <span>
          {problem.message}
          {text.trim() !== '' && <span className="db-formula-where"> · {L.describePosition(text, problem.start)}</span>}
        </span>
      </button>
    )
  }
  if (!text.trim()) return <div className="db-formula-status">Write an expression, like prop("Price") * 2</div>
  const kind = type ? L.FORMULA_TYPE_LABELS[type] : ''
  if (!outcome || rowTitle === null) return <div className="db-formula-status">Gives {kind}. Add a row to see a result.</div>
  if (!outcome.ok) {
    return (
      <div className="db-formula-status is-error">
        <span className="db-formula-error-mark" aria-hidden="true">
          !
        </span>
        <span>
          In {rowTitle}: {outcome.error}
        </span>
      </div>
    )
  }
  const shown = L.formulaText(outcome)
  return (
    <div className="db-formula-status is-ok">
      <span className="db-formula-row">{rowTitle}</span>
      <span className="db-formula-equals">=</span>
      <span className="db-formula-result">{shown === '' ? <span className="is-muted">empty</span> : shown}</span>
      <span className="db-formula-kind">{kind}</span>
    </div>
  )
}

export function FormulaEditor({
  databaseId,
  prop,
  onClose
}: {
  databaseId: string
  prop: PropertySchema
  onClose: () => void
}): JSX.Element {
  const { schema } = actions.snapshot(databaseId)
  const { cells } = useRelated()
  const ctx = useMemo(() => cells ?? actions.storeCellContext(), [cells])
  const [initial] = useState(() => L.formulaDisplayText(L.expressionOf(L.propOf(schema, prop.id) ?? prop), schema))
  const [text, setText] = useState(initial)
  const [caret, setCaret] = useState(initial.length)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // The caret starts at the end of the formula.
  const pendingSelection = useRef<[number, number] | null>([initial.length, initial.length])
  const escaped = useEscapePressed(rootRef)
  const saved = useRef(false)

  const row = actions.rowsOf(databaseId)[0]
  const preview = useMemo(() => L.previewFormula(text, prop.id, schema, row, ctx), [text, prop.id, schema, row, ctx])
  const completions = useMemo(
    () => (dismissed ? null : L.formulaCompletions(text, caret, schema, prop.id)),
    [text, caret, schema, prop.id, dismissed]
  )
  const properties = useMemo(() => L.orderedProperties(schema).filter((p) => p.id !== prop.id), [schema, prop.id])

  const save = (): void => {
    if (saved.current) return
    saved.current = true
    if (text !== initial) actions.setFormula(databaseId, prop.id, text)
  }
  // Closed by clicking elsewhere (or removed with its property): the formula is kept; Escape drops it.
  useCommitOnUnmount(() => {
    if (!escaped.current) save()
  })

  useLayoutEffect(() => {
    const selection = pendingSelection.current
    const el = inputRef.current
    if (!selection || !el) return
    pendingSelection.current = null
    el.focus()
    el.setSelectionRange(selection[0], selection[1])
  })

  const edit = (next: string, from: number, to = from): void => {
    setText(next)
    setCaret(to)
    setActive(0)
    setDismissed(false)
    pendingSelection.current = [from, to]
  }

  /** Puts `insert` in place of the text from `from` to `to` (the selection by default). */
  const insert = (snippet: string, from?: number, to?: number): void => {
    const el = inputRef.current
    const start = from ?? el?.selectionStart ?? text.length
    const end = to ?? el?.selectionEnd ?? start
    const next = (text.slice(0, start) + snippet + text.slice(end)).slice(0, L.FORMULA_LIMITS.length)
    const at = Math.min(start + snippet.length, next.length)
    edit(next, at)
  }

  const accept = (item: L.FormulaCompletion): void => {
    if (!completions) return
    insert(item.insert, completions.from, completions.to)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      save()
      onClose()
      return
    }
    const items = completions?.items ?? []
    if (!items.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      accept(items[Math.min(active, items.length - 1)])
    }
  }

  const syncCaret = (): void => {
    const el = inputRef.current
    if (el) setCaret(el.selectionStart)
  }

  const showProblem = (problem: L.FormulaProblem): void => {
    pendingSelection.current = [problem.start, Math.max(problem.start, problem.end)]
    setCaret(problem.start)
    setDismissed(true)
  }

  return (
    <div className="db-formula-editor" ref={rootRef}>
      <div className="db-panel-title">
        <TypeIcon type="formula" />
        <span className="db-formula-title">{prop.name}</span>
      </div>
      <textarea
        ref={inputRef}
        className="db-formula-input"
        value={text}
        autoFocus
        rows={3}
        spellCheck={false}
        aria-label="Formula"
        maxLength={L.FORMULA_LIMITS.length}
        placeholder='prop("Price") * prop("Quantity")'
        onChange={(event) => {
          setText(event.target.value)
          setCaret(event.target.selectionStart)
          setActive(0)
          setDismissed(false)
        }}
        onSelect={syncCaret}
        onKeyDown={onKeyDown}
        onBlur={() => setDismissed(true)}
        onFocus={() => setDismissed(false)}
      />
      {completions && (
        <div className="db-formula-suggestions" role="listbox" aria-label="Suggestions">
          {completions.items.map((item, index) => (
            <button
              key={`${item.kind}:${item.label}`}
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? 'db-formula-suggestion is-active' : 'db-formula-suggestion'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => accept(item)}
            >
              <span className="db-formula-suggestion-label">{item.label}</span>
              <span className="db-formula-suggestion-detail">{item.detail}</span>
            </button>
          ))}
        </div>
      )}
      <PreviewLine preview={preview} text={text} rowTitle={row ? L.titleOf(row) || 'Untitled' : null} onShow={showProblem} />
      <div className="db-formula-lists">
        <div className="db-formula-list" aria-label="Properties">
          <div className="db-formula-list-title">Properties</div>
          {properties.map((p) => (
            <button
              key={p.id}
              type="button"
              className="db-formula-item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(L.formulaPropRef(p.name))}
            >
              <TypeIcon type={p.type} size={12} />
              <span className="db-formula-item-name">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="db-formula-list" aria-label="Functions">
          <div className="db-formula-list-title">Functions</div>
          {L.FORMULA_FUNCTIONS.map((fn) => (
            <button
              key={fn.name}
              type="button"
              className="db-formula-item is-function"
              title={fn.signature}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(`${fn.name}(`)}
            >
              <span className="db-formula-item-name">{fn.signature}</span>
              <span className="db-formula-item-help">{fn.help}</span>
            </button>
          ))}
          {L.FORMULA_OPERATORS.map((op) => (
            <div key={op.name} className="db-formula-item is-operator">
              <span className="db-formula-item-name">{op.name}</span>
              <span className="db-formula-item-help">{op.help}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="db-formula-actions">
        <span className="db-formula-hint">Ctrl+Enter to save · Esc to cancel</span>
        <Button
          variant="primary"
          onClick={() => {
            save()
            onClose()
          }}
        >
          Done
        </Button>
      </div>
    </div>
  )
}
