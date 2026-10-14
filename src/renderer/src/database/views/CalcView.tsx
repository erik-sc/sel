// The "Calculations" view: figures computed from the rows of the view (its filters apply),
// each with a name and a formula. Clicking a figure edits it. Loaded on demand (lazyParts.tsx).
import { useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { ViewCalc } from '@shared/types'
import { Plus, Trash } from '@/ui/icons'
import * as L from '../logic'
import * as actions from '../actions'
import { Floating, type ViewProps } from '../common'
import { useCommitOnUnmount } from '../hooks'
import { CALC_FUNCTIONS, CALC_FUNCTION_LABELS, evaluateCalc, type CalcFunction, type CalcResult } from '../logic/calc'
import './calc.css'

const FORMAT_LABELS: Record<NonNullable<ViewCalc['format']> | 'auto', string> = {
  auto: 'Automatic',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent'
}

function resultText(result: CalcResult): string {
  if (!result.ok) return '—'
  if (result.value === null) return '—'
  // A figure is read at a glance: two decimals say enough (an average of thirds would fill the tile).
  return L.formatNumber(result.format === 'number' ? Math.round(result.value * 100) / 100 : result.value, result.format)
}

/** Replaces one calculation of the view as it is in the store when the edit lands (null removes it). */
function patchCalc(databaseId: string, viewId: string, calcId: string, change: (calc: ViewCalc) => ViewCalc | null): void {
  actions.patchView(databaseId, viewId, (view) => {
    const calcs = (view.calcs ?? []).flatMap((calc) => {
      if (calc.id !== calcId) return [calc]
      const next = change(calc)
      return next ? [next] : []
    })
    return { ...view, calcs }
  })
}

/** Name, formula and format of one calculation. Text is saved on blur, on Enter and when the popover closes. */
function CalcEditor(props: { databaseId: string; viewId: string; calc: ViewCalc; rows: ViewProps['rows']; schema: L.Schema; onClose: () => void }): JSX.Element {
  const { databaseId, viewId, calc, rows, schema, onClose } = props
  const [name, setName] = useState(calc.name)
  const [formula, setFormula] = useState(calc.formula)
  const [fn, setFn] = useState<CalcFunction>('sum')
  const formulaRef = useRef<HTMLInputElement>(null)
  const properties = useMemo(() => L.orderedProperties(schema), [schema])
  const numeric = useMemo(() => properties.filter((prop) => prop.type === 'number' || prop.type === 'checkbox'), [properties])
  // `count` takes any property; the others only what holds numbers.
  const offered = fn === 'count' ? properties : numeric
  const [propertyId, setPropertyId] = useState(() => numeric[0]?.id ?? '')
  const property = offered.find((prop) => prop.id === propertyId) ?? (fn === 'count' ? undefined : offered[0])

  const saved = useRef({ name: calc.name, formula: calc.formula })
  const commit = (): void => {
    const next = { name: L.cleanName(name), formula: formula.trim().slice(0, L.MAX_FORMULA_LENGTH) }
    if (next.name === saved.current.name && next.formula === saved.current.formula) return
    saved.current = next
    patchCalc(databaseId, viewId, calc.id, (current) => ({ ...current, ...next }))
  }
  useCommitOnUnmount(commit)

  const preview = evaluateCalc({ formula, format: calc.format }, rows, schema)

  const insert = (): void => {
    const snippet = `${fn}(${property ? L.calcRef(property.name) : ''})`
    const input = formulaRef.current
    const start = input?.selectionStart ?? formula.length
    const end = input?.selectionEnd ?? formula.length
    const next = (formula.slice(0, start) + snippet + formula.slice(end)).slice(0, L.MAX_FORMULA_LENGTH)
    setFormula(next)
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }

  const onEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    commit()
    onClose()
  }

  return (
    <div className="db-panel is-narrow db-calc-editor">
      <label className="db-calc-field">
        <span>Name</span>
        <input value={name} placeholder="Untitled" maxLength={L.MAX_NAME_LENGTH} onChange={(event) => setName(event.target.value)} onBlur={commit} onKeyDown={onEnter} />
      </label>
      <label className="db-calc-field">
        <span>Formula</span>
        <input
          ref={formulaRef}
          className="is-formula"
          autoFocus
          value={formula}
          placeholder="sum(Amount) / 12"
          spellCheck={false}
          maxLength={L.MAX_FORMULA_LENGTH}
          onChange={(event) => setFormula(event.target.value)}
          onBlur={commit}
          onKeyDown={onEnter}
        />
      </label>
      <p className={preview.ok ? 'db-calc-preview' : 'db-calc-preview is-error'} role="status">
        {preview.ok ? `= ${resultText(preview)}` : preview.error}
      </p>
      <div className="db-calc-insert">
        <select className="db-select" aria-label="Function" value={fn} onChange={(event) => setFn(event.target.value as CalcFunction)}>
          {CALC_FUNCTIONS.map((name) => (
            <option key={name} value={name}>
              {CALC_FUNCTION_LABELS[name]}
            </option>
          ))}
        </select>
        <select className="db-select is-wide" aria-label="Property" value={property?.id ?? ''} onChange={(event) => setPropertyId(event.target.value)}>
          {fn === 'count' && <option value="">All rows</option>}
          {offered.map((prop) => (
            <option key={prop.id} value={prop.id}>
              {prop.name || 'Untitled'}
            </option>
          ))}
        </select>
        <button type="button" className="db-mini-button is-text" disabled={fn !== 'count' && !property} onMouseDown={(event) => event.preventDefault()} onClick={insert}>
          Insert
        </button>
      </div>
      <div className="db-panel-actions">
        <select
          className="db-select"
          aria-label="Number format"
          value={calc.format ?? 'auto'}
          onChange={(event) => {
            const value = event.target.value
            patchCalc(databaseId, viewId, calc.id, ({ format: _format, ...rest }) => (value === 'auto' ? rest : { ...rest, format: value as ViewCalc['format'] }))
          }}
        >
          {(['auto', ...L.CALC_FORMATS] as const).map((format) => (
            <option key={format} value={format}>
              {FORMAT_LABELS[format]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="db-link-button is-danger"
          onClick={() => {
            // Nothing typed here outlives the calculation.
            saved.current = { name: L.cleanName(name), formula: formula.trim().slice(0, L.MAX_FORMULA_LENGTH) }
            patchCalc(databaseId, viewId, calc.id, () => null)
            onClose()
          }}
        >
          <Trash size={14} /> Remove
        </button>
      </div>
    </div>
  )
}

export function CalcView({ databaseId, schema, view, rows }: ViewProps): JSX.Element {
  const calcs = view.calcs ?? []
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const results = useMemo(() => new Map(calcs.map((calc) => [calc.id, evaluateCalc(calc, rows, schema)])), [calcs, rows, schema])
  const edited = editing ? calcs.find((calc) => calc.id === editing.id) : undefined
  const tiles = useRef(new Map<string, HTMLButtonElement>())

  const add = (): void => {
    if (calcs.length >= L.MAX_CALCS) return
    const id = L.makeId()
    actions.patchView(databaseId, view.id, (current) => ({ ...current, calcs: [...(current.calcs ?? []), { id, name: '', formula: '' }] }))
    // The new figure is drawn on the next frame: its editor opens from it.
    requestAnimationFrame(() => {
      const anchor = tiles.current.get(id)
      if (anchor) setEditing({ id, anchor })
    })
  }

  return (
    <div className="db-calcs">
      {calcs.map((calc) => {
        const result = results.get(calc.id) ?? { ok: false as const, error: '' }
        return (
          <button
            type="button"
            key={calc.id}
            ref={(element) => {
              if (element) tiles.current.set(calc.id, element)
              else tiles.current.delete(calc.id)
            }}
            className={editing?.id === calc.id ? 'db-calc is-active' : 'db-calc'}
            aria-haspopup="dialog"
            aria-expanded={editing?.id === calc.id}
            title={calc.formula || undefined}
            onClick={(event) => setEditing(editing?.id === calc.id ? null : { id: calc.id, anchor: event.currentTarget })}
          >
            <span className="db-calc-name">{calc.name || 'Untitled'}</span>
            <span className={result.ok && result.value !== null ? 'db-calc-value' : 'db-calc-value is-empty'}>{resultText(result)}</span>
            {!result.ok && <span className="db-calc-error">{result.error}</span>}
          </button>
        )
      })}
      {calcs.length < L.MAX_CALCS && (
        <button type="button" className={calcs.length ? 'db-calc is-add' : 'db-calc is-add is-only'} onClick={add}>
          <Plus size={14} />
          <span>Calculation</span>
        </button>
      )}
      {editing && edited && (
        <Floating open anchor={editing.anchor} onClose={() => setEditing(null)}>
          <CalcEditor key={edited.id} databaseId={databaseId} viewId={view.id} calc={edited} rows={rows} schema={schema} onClose={() => setEditing(null)} />
        </Floating>
      )}
    </div>
  )
}
