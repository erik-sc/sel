// The contents of the command palette. Loaded on demand through Palette.tsx.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { formatAccelerator } from '@shared/shortcuts'
import { IS_MAC } from '@/ui/platform'
import { ChevronRight } from '@/ui/icons'
import { availableCommands } from './registry'
import { rankCommands } from './match'
import { runPaletteCommand, usePalette } from './store'
import './palette.css'

export function PaletteBody() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const recent = usePalette((state) => state.recent)
  const nonce = usePalette((state) => state.nonce)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (index: number): string => `${listId}-${index}`

  // What can run is decided as the palette opens (the body mounts on every open).
  const commands = useMemo(() => availableCommands(), [])
  const items = useMemo(() => rankCommands(commands, query, recent), [commands, query, recent])
  const browsing = query.trim() === ''

  // Opening, or pressing Ctrl+K again while open: the field takes the focus, its text selected.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [nonce])

  useEffect(() => {
    listRef.current?.querySelector('.quickfind-item.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active, items])

  const run = (index: number): void => {
    const item = items[index]
    if (item) runPaletteCommand(item.command.id)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    // Keys pressed while an IME is composing belong to the composition.
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (items.length ? (index + 1) % items.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (items.length ? (index - 1 + items.length) % items.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(active)
    }
  }

  return (
    <>
      <div className="quickfind-input">
        <ChevronRight />
        <input
          ref={inputRef}
          value={query}
          placeholder="Type a command…"
          aria-label="Command"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items[active] ? optionId(active) : undefined}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="quickfind-list" id={listId} ref={listRef} role="listbox" aria-label="Commands">
        {items.map((item, index) => (
          <Fragment key={item.command.id}>
            {browsing && index === 0 && item.recent && (
              <div className="quickfind-heading" role="presentation">
                Recent
              </div>
            )}
            {browsing && index > 0 && !item.recent && items[index - 1].recent && (
              <div className="quickfind-heading" role="presentation">
                All commands
              </div>
            )}
            <div
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'quickfind-item palette-item is-active' : 'quickfind-item palette-item'}
              onMouseMove={() => {
                if (index !== active) setActive(index)
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(index)}
            >
              <span className="quickfind-title palette-title">{item.command.title}</span>
              {item.command.shortcut && <kbd className="palette-shortcut">{formatAccelerator(item.command.shortcut, IS_MAC)}</kbd>}
            </div>
          </Fragment>
        ))}
        {items.length === 0 && <div className="quickfind-empty">No matching commands</div>}
      </div>
      <div className="quickfind-footer">
        <span>
          <kbd>↑↓</kbd> Select
        </span>
        <span>
          <kbd>Enter</kbd> Run
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </>
  )
}
