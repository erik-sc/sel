// Option picker for select / multi-select cells, and the pane that edits one option.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { PropertySchema, SelectOption } from '@shared/types'
import { Check, ChevronLeft, MoreHorizontal, Trash } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { OptionTag, colorName, tagStyle } from './common'
import { useCommitOnUnmount } from './hooks'

/** Rename, recolour or delete one option of a select property. */
export function OptionEditPane({
  databaseId,
  prop,
  option,
  onBack,
  onDeleted
}: {
  databaseId: string
  prop: PropertySchema
  option: SelectOption
  onBack?: () => void
  onDeleted?: () => void
}): JSX.Element {
  const [name, setName] = useState(option.name)
  // Only a name the user actually typed is written: an untouched input never
  // overwrites a rename that arrived from elsewhere in the meantime.
  const dirty = useRef(false)
  const commitName = (): void => {
    if (!dirty.current) return
    dirty.current = false
    if (L.cleanName(name)) actions.updateOption(databaseId, prop.id, option.id, { name })
  }
  useCommitOnUnmount(commitName)
  useEffect(() => {
    if (!dirty.current) setName(option.name)
  }, [option.name])

  return (
    <div className="db-option-edit">
      <div className="db-option-edit-head">
        {onBack && (
          <button type="button" className="db-mini-button" aria-label="Back" onClick={onBack}>
            <ChevronLeft size={14} />
          </button>
        )}
        <input
          className="ui-input"
          value={name}
          autoFocus
          maxLength={L.MAX_NAME_LENGTH}
          aria-label="Option name"
          onChange={(event) => {
            dirty.current = true
            setName(event.target.value)
          }}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Escape') return
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              commitName()
              onBack?.()
            }
          }}
        />
      </div>
      <button
        type="button"
        className="db-menu-row is-danger"
        onClick={() => {
          dirty.current = false
          actions.deleteOption(databaseId, prop.id, option.id)
          onDeleted?.()
          onBack?.()
        }}
      >
        <Trash size={14} />
        <span>Delete option</span>
      </button>
      <div className="db-menu-heading">Colour</div>
      {L.OPTION_COLORS.map((color) => (
        <button
          type="button"
          key={color}
          className="db-menu-row"
          onClick={() => actions.updateOption(databaseId, prop.id, option.id, { color })}
        >
          <span className="db-swatch" style={tagStyle(color)} />
          <span className="db-menu-row-label">{color[0].toUpperCase() + color.slice(1)}</span>
          {colorName(option.color) === color && <Check size={14} />}
        </button>
      ))}
    </div>
  )
}

/** Derives the next selection from the selection as it is in the store when the edit lands. */
export type SelectionUpdate = (current: string[]) => string[]

export function SelectEditor({
  databaseId,
  prop,
  value,
  multiple,
  onChange,
  onClose
}: {
  databaseId: string
  prop: PropertySchema
  /** Selected option ids, for display only. */
  value: string[]
  multiple: boolean
  onChange: (update: SelectionUpdate) => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionId = (index: number): string => `${listId}-${index}`
  const options = L.optionsOf(prop)

  const q = L.cleanName(query).toLocaleLowerCase()
  const filtered = useMemo(() => (q ? options.filter((o) => o.name.toLocaleLowerCase().includes(q)) : options), [options, q])
  const selected = useMemo(() => new Set(value), [value])
  const exact = q ? options.some((o) => L.cleanName(o.name).toLocaleLowerCase() === q) : false
  const canCreate = q !== '' && !exact
  const count = filtered.length + (canCreate ? 1 : 0)
  const activeIndex = Math.min(active, Math.max(0, count - 1))

  useEffect(() => {
    if (!editingId) inputRef.current?.focus({ preventScroll: true })
  }, [editingId])

  const editingOption = editingId ? L.findOption(prop, editingId) : undefined
  if (editingOption) {
    return (
      <div className="db-select-editor">
        <OptionEditPane
          key={editingOption.id}
          databaseId={databaseId}
          prop={prop}
          option={editingOption}
          onBack={() => setEditingId(null)}
        />
      </div>
    )
  }

  const remove = (id: string): void => onChange((ids) => ids.filter((v) => v !== id))

  const pick = (id: string): void => {
    if (multiple) {
      onChange((ids) => (ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id]))
      setQuery('')
      setActive(0)
      inputRef.current?.focus({ preventScroll: true })
    } else {
      onChange(() => [id])
      onClose()
    }
  }

  const create = (): void => {
    const id = actions.addOption(databaseId, prop.id, query)
    if (id) pick(id)
  }

  const choose = (index: number): void => {
    if (index < filtered.length) pick(filtered[index].id)
    else if (canCreate) create()
  }

  return (
    <div className="db-select-editor">
      <div className="db-select-input" onClick={() => inputRef.current?.focus()}>
        {value.map((id) => {
          const option = L.findOption(prop, id)
          return option ? <OptionTag key={id} option={option} onRemove={() => remove(id)} /> : null
        })}
        <input
          ref={inputRef}
          value={query}
          maxLength={L.MAX_NAME_LENGTH}
          placeholder={value.length ? '' : 'Search or create an option…'}
          aria-label="Search options"
          role="combobox"
          aria-expanded={count > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={count ? optionId(activeIndex) : undefined}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') return
            event.stopPropagation()
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive(count ? (activeIndex + 1) % count : 0)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive(count ? (activeIndex - 1 + count) % count : 0)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (count) choose(activeIndex)
              else onClose()
            } else if (event.key === 'Backspace' && query === '' && value.length) {
              onChange((ids) => ids.slice(0, -1))
            } else if (event.key === 'Tab') {
              event.preventDefault()
              onClose()
            }
          }}
        />
      </div>
      <div className="db-menu-heading">{options.length ? 'Select an option or create one' : 'Type a name to create an option'}</div>
      <div
        className="db-select-list"
        id={listId}
        role={count ? 'listbox' : undefined}
        aria-label={count ? prop.name : undefined}
        aria-multiselectable={count && multiple ? true : undefined}
      >
        {filtered.map((option, index) => (
          <div
            key={option.id}
            id={optionId(index)}
            role="option"
            aria-selected={selected.has(option.id)}
            className={index === activeIndex ? 'db-select-option is-active' : 'db-select-option'}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(option.id)}
          >
            <OptionTag option={option} />
            <span className="db-spacer" />
            {selected.has(option.id) && <Check size={14} />}
            {/* For the pointer only: an option is read and chosen whole, so nothing inside it takes the focus. */}
            <span
              className="db-mini-button"
              aria-hidden="true"
              title={`Edit ${option.name}`}
              onClick={(event) => {
                event.stopPropagation()
                setEditingId(option.id)
              }}
            >
              <MoreHorizontal size={14} />
            </span>
          </div>
        ))}
        {canCreate && (
          <div
            id={optionId(filtered.length)}
            role="option"
            aria-selected={false}
            className={activeIndex === filtered.length ? 'db-select-option is-active' : 'db-select-option'}
            onMouseEnter={() => setActive(filtered.length)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={create}
          >
            <span className="db-select-create">Create</span>
            <span className="db-tag" style={tagStyle(L.nextOptionColor(options))}>
              <span className="db-tag-label">{L.cleanName(query)}</span>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
