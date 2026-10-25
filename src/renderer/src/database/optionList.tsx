// A select's options in its property menu (0.9.0, B3): the options as their tags, one Tab stop
// (roving tabindex), reordered by dragging a row's handle or with Alt+ArrowUp/ArrowDown, and a
// field under them that adds one. Opening an option is the menu's business (`onOpen`): it swaps
// the popover's content for the option's edit pane.
import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent, JSX, KeyboardEvent, RefObject } from 'react'
import type { PropertySchema } from '@shared/types'
import { announce } from '@/a11y/announce'
import { rovingTarget } from '@/a11y/keys'
import { DragHandle } from '@/ui/icons'
import * as L from './logic'
import * as actions from './actions'
import { OptionTag } from './common'
import { useDatabaseCopy } from './copy'

/** Where the focus goes when the list is drawn: an option (by id), or the add field. */
export type OptionFocus = { optionId: string } | 'add' | null

/** Where an option dragged from `from` lands when dropped on the line `before` (0 to length). */
export function dropIndex(from: number, before: number): number {
  return before > from ? before - 1 : before
}

export function OptionList({
  databaseId,
  prop,
  fixedOrder,
  initialFocus,
  addRef,
  onOpen
}: {
  databaseId: string
  prop: PropertySchema
  /** The options' order and presence are read by the app (the Tasks priorities): no moves. */
  fixedOrder: boolean
  initialFocus: OptionFocus
  addRef: RefObject<HTMLInputElement | null>
  onOpen: (optionId: string) => void
}): JSX.Element {
  const copy = useDatabaseCopy()
  const options = L.optionsOf(prop)
  const headerId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  // The option that is the list's Tab stop: the one focused last (the first while none was).
  const [stopId, setStopId] = useState<string | null>(initialFocus && initialFocus !== 'add' ? initialFocus.optionId : null)
  // An option to focus once it is drawn (after a move, or when the list comes back from the pane).
  const pendingFocus = useRef<string | null>(stopId)
  // An option to bring into view once it is drawn (just added, or typed again).
  const pendingScroll = useRef<string | null>(null)
  const [draft, setDraft] = useState('')
  const [drag, setDrag] = useState<{ id: string; before: number | null } | null>(null)

  const stopIndex = Math.max(
    0,
    options.findIndex((o) => o.id === stopId)
  )

  const rowOf = (id: string): HTMLElement | null =>
    listRef.current?.querySelector<HTMLElement>(`[data-option-id="${CSS.escape(id)}"]`) ?? null

  // After every draw: what it waits for is in refs.
  useEffect(() => {
    const focusId = pendingFocus.current
    if (focusId) {
      const button = rowOf(focusId)?.querySelector<HTMLElement>('.db-option-button')
      if (button) {
        pendingFocus.current = null
        button.focus({ preventScroll: true })
        button.scrollIntoView({ block: 'nearest' })
      }
    }
    const scrollId = pendingScroll.current
    if (scrollId) {
      const row = rowOf(scrollId)
      if (row) {
        pendingScroll.current = null
        row.scrollIntoView({ block: 'nearest' })
      }
    }
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount: where the list was opened from.
  useEffect(() => {
    if (initialFocus === 'add') addRef.current?.focus({ preventScroll: true })
  }, [])

  const move = (index: number, to: number): void => {
    const option = options[index]
    if (!option || to < 0 || to >= options.length || to === index) return
    actions.moveOption(databaseId, prop.id, option.id, to)
    pendingFocus.current = option.id
    setStopId(option.id)
    announce(copy.options.moved(option.name, to + 1, options.length))
  }

  const onOptionKey = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.altKey) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      if (!fixedOrder) move(index, index + (event.key === 'ArrowUp' ? -1 : 1))
      return
    }
    const to = rovingTarget(event.key, index, options.length, 'vertical')
    if (to === null) return
    event.preventDefault()
    const target = options[to]
    setStopId(target.id)
    pendingFocus.current = target.id
    // Drawn already: focus it now, so the key's effect is not a frame late.
    const button = rowOf(target.id)?.querySelector<HTMLElement>('.db-option-button')
    if (button) {
      pendingFocus.current = null
      button.focus()
      button.scrollIntoView({ block: 'nearest' })
    }
  }

  const add = (): void => {
    const name = L.cleanName(draft)
    if (!name) return
    const key = name.toLocaleLowerCase()
    const existing = options.find((o) => L.cleanName(o.name).toLocaleLowerCase() === key)
    setDraft('')
    if (existing) {
      // The same name: nothing is lost, it is already there.
      pendingScroll.current = existing.id
      rowOf(existing.id)?.scrollIntoView({ block: 'nearest' })
      return
    }
    const id = actions.addOption(databaseId, prop.id, name)
    if (!id) return
    pendingScroll.current = id
    announce(copy.options.added(name))
  }

  // ---- dragging, by the handle ----
  const onDragOver = (event: DragEvent<HTMLElement>, index: number): void => {
    if (!drag) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const box = event.currentTarget.getBoundingClientRect()
    const before = event.clientY < box.top + box.height / 2 ? index : index + 1
    if (drag.before !== before) setDrag({ ...drag, before })
  }
  const onDrop = (event: DragEvent<HTMLElement>): void => {
    if (!drag) return
    event.preventDefault()
    const from = options.findIndex((o) => o.id === drag.id)
    if (from >= 0 && drag.before !== null) {
      const to = dropIndex(from, drag.before)
      if (to !== from) {
        actions.moveOption(databaseId, prop.id, drag.id, to)
        announce(copy.options.moved(options[from].name, to + 1, options.length))
      }
    }
    setDrag(null)
  }

  return (
    <div className="db-option-section">
      <div className="ui-menu-header" id={headerId}>
        {copy.options.header}
      </div>
      {options.length > 0 && (
        <div
          ref={listRef}
          className="db-option-list"
          role="list"
          aria-labelledby={headerId}
          onDragLeave={(event) => {
            if (drag && !event.currentTarget.contains(event.relatedTarget as Node | null)) setDrag({ ...drag, before: null })
          }}
        >
          {options.map((option, index) => {
            const classes = ['db-option-row']
            if (drag?.id === option.id) classes.push('is-dragging')
            if (drag && drag.before === index) classes.push('drop-before')
            if (drag && drag.before === index + 1 && index === options.length - 1) classes.push('drop-after')
            return (
              <div
                key={option.id}
                role="listitem"
                aria-posinset={index + 1}
                aria-setsize={options.length}
                className={classes.join(' ')}
                data-option-id={option.id}
                onDragOver={(event) => onDragOver(event, index)}
                onDrop={onDrop}
              >
                <button
                  type="button"
                  className="db-option-button"
                  tabIndex={index === stopIndex ? 0 : -1}
                  title={option.name}
                  onFocus={() => setStopId(option.id)}
                  onKeyDown={(event) => onOptionKey(event, index)}
                  onClick={() => onOpen(option.id)}
                >
                  <OptionTag option={option} />
                </button>
                {!fixedOrder && (
                  <button
                    type="button"
                    className="db-option-handle"
                    tabIndex={-1}
                    aria-label={copy.options.move(option.name)}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      try {
                        event.dataTransfer.setData('text/plain', option.name)
                      } catch {
                        // Some platforms refuse it; the state above is enough.
                      }
                      const row = event.currentTarget.closest('.db-option-row')
                      if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2)
                      setDrag({ id: option.id, before: null })
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    <DragHandle size={14} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="db-option-add">
        <input
          ref={addRef}
          className="ui-input"
          value={draft}
          placeholder={copy.options.add}
          aria-label={copy.options.add}
          maxLength={L.MAX_NAME_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== 'Enter') return
            event.preventDefault()
            add()
          }}
        />
      </div>
    </div>
  )
}
