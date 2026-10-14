// Relation cells: the linked rows as chips that open them, and the picker that links and
// unlinks rows of the related database.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Block, PropertySchema } from '@shared/types'
import { Check, Close, Page, Plus } from '@/ui/icons'
import { IconGlyph } from '@/ui/IconGlyph'
import * as L from './logic'
import * as actions from './actions'
import { wantsNewTab } from './common'
import { useRelated } from './related'

/** Rows listed at once; typing narrows the list down. */
const MAX_LISTED = 100

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
}

/** One linked row: its icon and title. Clicking opens it (Ctrl+click or middle click: a new tab). */
export function RelationChip({ row, onRemove }: { row: Block; onRemove?: () => void }): JSX.Element {
  const { openPage } = useRelated()
  const title = L.titleOf(row) || 'Untitled'
  const icon = L.iconOf(row)
  const open = (event: ReactMouseEvent | ReactKeyboardEvent, newTab: boolean): void => {
    if (!openPage) return
    event.preventDefault()
    event.stopPropagation()
    openPage(row.id, newTab ? { newTab: true } : undefined)
  }
  return (
    <span
      className={openPage ? 'db-relation is-link' : 'db-relation'}
      role={openPage ? 'link' : undefined}
      tabIndex={openPage ? 0 : undefined}
      title={title}
      onMouseDown={(event) => {
        if (openPage) event.stopPropagation()
      }}
      onClick={(event) => open(event, wantsNewTab(event))}
      onAuxClick={(event) => {
        if (event.button === 1) open(event, true)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open(event, false)
      }}
    >
      <span className="db-relation-icon">{icon ? <IconGlyph icon={icon} /> : <Page size={12} />}</span>
      <span className="db-relation-label">{title}</span>
      {onRemove && (
        <button
          type="button"
          className="db-tag-remove"
          aria-label={`Unlink ${title}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <Close size={10} />
        </button>
      )}
    </span>
  )
}

/** A relation cell: the rows it links to that still exist. */
export function RelationValue({ row, prop }: { row: Block; prop: PropertySchema }): JSX.Element | null {
  const { cells } = useRelated()
  if (!cells) return null
  const linked = L.linkedRows(row, prop, cells)
  if (!linked.length) return null
  return (
    <span className="db-tags">
      {linked.map((linkedRow) => (
        <RelationChip key={linkedRow.id} row={linkedRow} />
      ))}
    </span>
  )
}

function unavailableText(state: L.RelatedDatabaseState): string {
  if (state === 'trashed') return 'The related database is in the trash.'
  if (state === 'missing') return 'The related database was deleted.'
  return 'Loading…'
}

/**
 * Picker of the rows a relation cell links to: type to search the related database, click
 * or Enter to link or unlink, or create a row with the typed title. Under a limit of one,
 * picking a row replaces the link and closes the picker.
 */
export function RelationEditor({ row, prop, onClose }: { row: Block; prop: PropertySchema; onClose: () => void }): JSX.Element {
  const { cells } = useRelated()
  const config = L.relationOf(prop)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [])

  const state = config && cells ? L.relatedDatabaseState(config.databaseId, cells) : 'loading'
  const candidates = useMemo(() => (config && cells ? L.linkableRows(config, cells) : []), [config, cells])
  const linked = cells ? L.linkedRows(row, prop, cells) : []
  const linkedIds = new Set(linked.map((b) => b.id))
  const needle = fold(query.trim())
  const matches = useMemo(() => {
    const found = needle ? candidates.filter((b) => fold(L.titleOf(b)).includes(needle)) : candidates
    return found.slice(0, MAX_LISTED)
  }, [candidates, needle])
  const exact = needle !== '' && candidates.some((b) => fold(L.titleOf(b).trim()) === needle)
  const canCreate = needle !== '' && !exact && state === 'ok'
  const count = matches.length + (canCreate ? 1 : 0)
  const activeIndex = Math.min(active, Math.max(0, count - 1))

  useEffect(() => {
    listRef.current?.querySelector('.db-select-option.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, matches])

  if (!config) {
    return (
      <div className="db-select-editor">
        <div className="db-panel-empty">Choose the database this relation links to in its property menu.</div>
      </div>
    )
  }
  if (state !== 'ok') {
    return (
      <div className="db-select-editor">
        <div className="db-panel-empty">{unavailableText(state)}</div>
      </div>
    )
  }

  const toggle = (id: string): void => {
    actions.updateRelation(row.id, prop, (current) => L.toggleLink(current, id, config.limit))
    if (config.limit === 'one' && !linkedIds.has(id)) onClose()
    else {
      setQuery('')
      setActive(0)
      inputRef.current?.focus({ preventScroll: true })
    }
  }

  const create = (): void => {
    const title = query.trim()
    if (!title) return
    const id = actions.createRow(config.databaseId, { title })
    toggle(id)
  }

  const choose = (index: number): void => {
    if (index < matches.length) toggle(matches[index].id)
    else if (canCreate) create()
  }

  const targetTitle = L.titleOf(cells?.get(config.databaseId)) || 'Untitled'

  return (
    <div className="db-select-editor db-relation-editor">
      <div className="db-select-input" onClick={() => inputRef.current?.focus()}>
        {linked.map((b) => (
          <RelationChip key={b.id} row={b} onRemove={() => toggle(b.id)} />
        ))}
        <input
          ref={inputRef}
          value={query}
          maxLength={L.MAX_NAME_LENGTH}
          placeholder={linked.length ? '' : `Search ${targetTitle}…`}
          aria-label={`Search ${targetTitle}`}
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
            } else if (event.key === 'Backspace' && query === '' && linked.length) {
              toggle(linked[linked.length - 1].id)
            } else if (event.key === 'Tab') {
              event.preventDefault()
              onClose()
            }
          }}
        />
      </div>
      <div className="db-menu-heading">
        {candidates.length ? `Link to a page of ${targetTitle}` : `${targetTitle} has no pages yet: type a title to add one`}
      </div>
      <div className="db-select-list" ref={listRef} role="listbox" aria-label={`Pages of ${targetTitle}`}>
        {matches.map((b, index) => (
          <div
            key={b.id}
            role="option"
            aria-selected={linkedIds.has(b.id)}
            className={index === activeIndex ? 'db-select-option is-active' : 'db-select-option'}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggle(b.id)}
          >
            <span className="db-relation-icon">{L.iconOf(b) ? <IconGlyph icon={L.iconOf(b) as string} /> : <Page size={12} />}</span>
            <span className="db-relation-option">{L.titleOf(b) || 'Untitled'}</span>
            <span className="db-spacer" />
            {linkedIds.has(b.id) && <Check size={14} />}
          </div>
        ))}
        {canCreate && (
          <div
            className={activeIndex === matches.length ? 'db-select-option is-active' : 'db-select-option'}
            onMouseEnter={() => setActive(matches.length)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={create}
          >
            <Plus size={14} />
            <span className="db-select-create">New page</span>
            <span className="db-relation-option">{query.trim()}</span>
          </div>
        )}
        {!matches.length && !canCreate && needle !== '' && <div className="db-panel-empty">No pages match your search</div>}
      </div>
    </div>
  )
}
