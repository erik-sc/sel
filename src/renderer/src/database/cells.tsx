// Cell rendering and the in-place editors, shared by every view and the row page.
import { Suspense, memo, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { Block, PropertySchema, PropertyValue } from '@shared/types'
import { Check } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { Floating, OptionTag } from './common'
import { DatePicker, PartFallback } from './lazyParts'
import { SelectEditor } from './SelectEditor'
import { RelationEditor, RelationValue } from './RelationEditor'
import { useRelated } from './related'
import { useCommitOnUnmount } from './hooks'

export type EditMove = 'next' | 'prev' | undefined

/** Opens a url cell in the system browser. Only http(s) and mailto ever leave the app. */
export function openUrl(url: string): void {
  const target = L.safeExternalUrl(url)
  if (!target) return
  window.api.app.openExternal(target).catch((error) => console.error('openExternal failed', error))
}

/** Whether a cell shows anything. Relations, rollups and formulas need the context (`cells`) to tell. */
export function hasDisplayValue(row: Block, prop: PropertySchema, cells?: L.CellContext): boolean {
  if (prop.type === 'formula') {
    const outcome = cells ? L.computeFormula(row, prop, cells) : null
    // One that fails shows its error; an unchecked result shows nothing, like a checkbox.
    return !!outcome && (!outcome.ok || !L.isEmptyFormulaValue(outcome.value))
  }
  const value = L.readCell(row, prop, cells)
  return prop.type === 'checkbox' ? value === true : !L.isEmptyValue(value)
}

/** A rollup cell: its result, formatted like the property it reads; the original values as tags or text. */
function RollupValue({ row, prop }: { row: Block; prop: PropertySchema }): JSX.Element | null {
  const { cells } = useRelated()
  const result = cells ? L.computeRollup(row, prop, cells) : null
  if (!result) return null
  if (result.kind === 'number') {
    return result.value === null ? null : <span className="db-text is-number">{L.formatNumber(result.value, result.format)}</span>
  }
  if (result.kind === 'date') return result.value ? <span className="db-text">{L.formatDate(result.value)}</span> : null
  if (!result.items.length) return null
  if (result.items.some((item) => item.option)) {
    return (
      <span className="db-tags">
        {result.items.map((item, index) =>
          item.option ? <OptionTag key={index} option={item.option} /> : <span key={index} className="db-text">{item.text}</span>
        )}
      </span>
    )
  }
  return <span className="db-text">{result.items.map((item) => item.text).join(', ')}</span>
}

/**
 * A formula cell: its result like a cell of that type (a checkbox, a right-aligned number,
 * a date or text), or a small "!" with what is wrong.
 */
function FormulaValue({ row, prop }: { row: Block; prop: PropertySchema }): JSX.Element | null {
  const { cells } = useRelated()
  const outcome = cells ? L.computeFormula(row, prop, cells) : null
  if (!outcome) return null
  if (!outcome.ok) {
    return (
      <span className="db-formula-error" title={outcome.error}>
        <span className="db-formula-error-mark" aria-hidden="true">
          !
        </span>
        <span className="db-formula-error-text">{outcome.error}</span>
      </span>
    )
  }
  if (outcome.type === 'checkbox') {
    return (
      <span className={outcome.value === true ? 'db-checkbox is-checked' : 'db-checkbox'} role="img" aria-label={outcome.value === true ? 'Yes' : 'No'}>
        {outcome.value === true && <Check size={12} />}
      </span>
    )
  }
  const text = L.formulaText(outcome)
  if (!text) return null
  return <span className={outcome.type === 'number' ? 'db-text is-number' : 'db-text'}>{text}</span>
}

/** A url cell: a link-like control (never an anchor with a raw href) when the url is safe to open. */
function UrlValue({ url }: { url: string }): JSX.Element {
  if (!L.safeExternalUrl(url)) {
    return (
      <span className="db-text" title="This link cannot be opened (only http, https and mailto are allowed)">
        {url}
      </span>
    )
  }
  return (
    <span
      className="db-url"
      role="link"
      tabIndex={0}
      title={url}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        openUrl(url)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        event.stopPropagation()
        openUrl(url)
      }}
    >
      {url}
    </span>
  )
}

/** Read-only rendering of a cell. Returns null when there is nothing to show. */
export function CellDisplay({ row, prop }: { row: Block; prop: PropertySchema }): JSX.Element | null {
  const value = L.getCellValue(row, prop)
  switch (prop.type) {
    case 'title': {
      const text = typeof value === 'string' ? value : ''
      return text ? <span className="db-text">{text}</span> : <span className="db-text is-muted">Untitled</span>
    }
    case 'checkbox':
      return (
        <span className={value === true ? 'db-checkbox is-checked' : 'db-checkbox'} aria-hidden="true">
          {value === true && <Check size={12} />}
        </span>
      )
    case 'select': {
      const option = L.findOption(prop, value)
      return option ? <OptionTag option={option} /> : null
    }
    case 'multi_select': {
      const ids = Array.isArray(value) ? value : []
      if (!ids.length) return null
      return (
        <span className="db-tags">
          {ids.map((id) => {
            const option = L.findOption(prop, id)
            return option ? <OptionTag key={id} option={option} /> : null
          })}
        </span>
      )
    }
    case 'url':
      return typeof value === 'string' && value ? <UrlValue url={value} /> : null
    case 'relation':
      return <RelationValue row={row} prop={prop} />
    case 'rollup':
      return <RollupValue row={row} prop={prop} />
    case 'formula':
      return <FormulaValue row={row} prop={prop} />
    default: {
      const text = L.formatValue(value, prop)
      if (!text) return null
      return <span className={prop.type === 'number' ? 'db-text is-number' : 'db-text'}>{text}</span>
    }
  }
}

/** Non-title, non-empty visible properties of a row (cards, list rows). */
export const RowProps = memo(function RowProps({
  row,
  props,
  skip,
  className
}: {
  row: Block
  props: PropertySchema[]
  skip?: string
  className?: string
}): JSX.Element | null {
  // Reading the context re-renders the card when related rows change (it is memoised on its row).
  const { cells } = useRelated()
  const shown = props.filter((p) => p.type !== 'title' && p.id !== skip && hasDisplayValue(row, p, cells))
  if (!shown.length) return null
  return (
    <div className={className ?? 'db-row-props'}>
      {shown.map((p) => (
        <span key={p.id} className="db-row-prop" title={p.name}>
          <CellDisplay row={row} prop={p} />
        </span>
      ))}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Text-like editor (title, text, url, number)
// ---------------------------------------------------------------------------

/** The text an editor starts with; `parseNumberInput` reads number text back exactly. */
function editText(row: Block, prop: PropertySchema): string {
  const current = L.getCellValue(row, prop)
  if (current === null || current === undefined) return ''
  return typeof current === 'number' ? L.numberToInput(current) : String(current)
}

function TextEditor({
  row,
  prop,
  initialText,
  discardOnCancel,
  onStop
}: {
  row: Block
  prop: PropertySchema
  initialText?: string
  discardOnCancel: boolean
  onStop: (move?: EditMove) => void
}): JSX.Element {
  // What the cell held when editing started: an untouched editor never writes,
  // so it cannot overwrite a change that arrived from elsewhere meanwhile.
  const [baseline] = useState(() => editText(row, prop))
  const [text, setText] = useState(initialText ?? baseline)
  const inputRef = useRef<HTMLInputElement>(null)
  const typed = useRef(initialText !== undefined)
  const done = useRef(false)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    if (typed.current) el.setSelectionRange(el.value.length, el.value.length)
    else el.select()
  }, [])

  const commit = (): void => {
    if (text === baseline) return
    if (prop.type === 'number') {
      const parsed = L.parseNumberInput(text, prop.numberFormat)
      // Not a number: leave the cell as it was rather than wiping it.
      if (parsed !== undefined) actions.setCell(row.id, prop, parsed)
      return
    }
    actions.setCell(row.id, prop, prop.type === 'title' ? text : text.trim() === '' ? null : text)
  }

  const finish = (save: boolean, move?: EditMove): void => {
    if (done.current) return
    done.current = true
    if (save) commit()
    else if (discardOnCancel) actions.discardPristineRow(row.id)
    onStop(move)
  }

  // Removed without a blur (row scrolled out of the window, view switched...).
  useCommitOnUnmount(() => {
    if (done.current) return
    done.current = true
    commit()
  })

  return (
    <input
      ref={inputRef}
      className={prop.type === 'number' ? 'db-cell-input is-number' : 'db-cell-input'}
      value={text}
      aria-label={prop.name}
      maxLength={L.MAX_TEXT_LENGTH}
      inputMode={prop.type === 'number' ? 'decimal' : undefined}
      spellCheck={prop.type !== 'url' && prop.type !== 'number'}
      onChange={(event) => setText(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(false)
        } else if (event.key === 'Tab') {
          event.preventDefault()
          finish(true, event.shiftKey ? 'prev' : 'next')
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}

// ---------------------------------------------------------------------------
// PropertyCell: display + editor for one cell
// ---------------------------------------------------------------------------

export function isTextLike(type: PropertySchema['type']): boolean {
  return type === 'title' || type === 'text' || type === 'url' || type === 'number'
}

function selectedIds(value: PropertyValue): string[] {
  if (Array.isArray(value)) return value
  return typeof value === 'string' && value ? [value] : []
}

/** Types whose cells read other rows or the schema (through the related context). */
function isRelatedType(type: PropertySchema['type']): boolean {
  return type === 'relation' || type === 'rollup' || type === 'formula'
}

/** What a cell shows when it is not being edited: its value, or the placeholder when it is empty. */
function CellBody({ row, prop, placeholder, cells }: { row: Block; prop: PropertySchema; placeholder?: string; cells?: L.CellContext }): JSX.Element | null {
  const isEmpty = prop.type !== 'title' && !hasDisplayValue(row, prop, cells)
  return isEmpty && placeholder ? <span className="db-text is-muted">{placeholder}</span> : <CellDisplay row={row} prop={prop} />
}

/**
 * The same for a relation, a rollup or a formula. Only these cells read the related context,
 * so a change in another database re-renders them and leaves the other cells of a row alone.
 */
function RelatedCellBody(props: { row: Block; prop: PropertySchema; placeholder?: string }): JSX.Element | null {
  const { cells } = useRelated()
  return <CellBody {...props} cells={cells} />
}

export interface PropertyCellProps {
  databaseId: string
  row: Block
  prop: PropertySchema
  editing: boolean
  /** Text that replaces the current value when editing starts by typing. */
  initialText?: string
  /** The row was just created for this edit: Escape removes it again if it is still empty. */
  discardOnCancel?: boolean
  onStartEdit: () => void
  onStopEdit: (move?: EditMove) => void
  placeholder?: string
}

export function PropertyCell({
  databaseId,
  row,
  prop,
  editing,
  initialText,
  discardOnCancel = false,
  onStartEdit,
  onStopEdit,
  placeholder
}: PropertyCellProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const readOnly = L.isComputedType(prop.type)
  const value = L.getCellValue(row, prop)

  if (prop.type === 'checkbox') {
    return (
      <div className="db-cell-value">
        <span
          role="checkbox"
          aria-checked={value === true}
          aria-label={prop.name}
          className={value === true ? 'db-checkbox is-interactive is-checked' : 'db-checkbox is-interactive'}
          onClick={(event) => {
            event.stopPropagation()
            actions.toggleCheckbox(row.id, prop)
          }}
        >
          {value === true && <Check size={12} />}
        </span>
      </div>
    )
  }

  if (editing && isTextLike(prop.type)) {
    return (
      <div className="db-cell-value is-editing">
        <TextEditor row={row} prop={prop} initialText={initialText} discardOnCancel={discardOnCancel} onStop={onStopEdit} />
      </div>
    )
  }

  const popoverType = L.isSelectType(prop.type) || prop.type === 'date' || prop.type === 'relation'

  return (
    <div
      ref={setEl}
      className={readOnly ? 'db-cell-value is-readonly' : 'db-cell-value'}
      onClick={() => {
        if (readOnly) return
        if (editing) {
          if (popoverType) onStopEdit()
        } else {
          onStartEdit()
        }
      }}
    >
      {isRelatedType(prop.type) ? (
        <RelatedCellBody row={row} prop={prop} placeholder={placeholder} />
      ) : (
        <CellBody row={row} prop={prop} placeholder={placeholder} />
      )}
      {popoverType && (
        <Floating open={editing && !!el} anchor={el} onClose={() => onStopEdit()} className="db-popover">
          {prop.type === 'date' ? (
            <Suspense fallback={<PartFallback kind="popover" />}>
              <DatePicker value={L.isDateValue(value) ? value : null} onChange={(next) => actions.setCell(row.id, prop, next)} />
            </Suspense>
          ) : prop.type === 'relation' ? (
            <RelationEditor row={row} prop={prop} onClose={() => onStopEdit()} />
          ) : (
            <SelectEditor
              databaseId={databaseId}
              prop={prop}
              multiple={prop.type === 'multi_select'}
              value={selectedIds(value)}
              onChange={(update) =>
                actions.updateCell(row.id, prop, (current) => {
                  const ids = update(selectedIds(current))
                  return prop.type === 'multi_select' ? ids : (ids[ids.length - 1] ?? null)
                })
              }
              onClose={() => onStopEdit()}
            />
          )}
        </Floating>
      )}
    </div>
  )
}
