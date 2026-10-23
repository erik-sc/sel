// The contents of the keyboard shortcuts screen. Loaded on demand through Host.tsx.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { IS_MAC } from '@/ui/platform'
import { Search } from '@/ui/icons'
import { aiEnabled } from '@/ai/gate'
import { usePersona } from '@/herman/gate'
import { shownShortcuts, type ShownEntry } from './catalog'
import { useShortcutsGate } from './gate'
import './shortcuts.css'

function Keys({ entry }: { entry: ShownEntry }) {
  return (
    <>
      {entry.typed !== undefined && <code className="sc-typed">{entry.typed}</code>}
      {entry.thenSpace && <kbd className="sc-key">Space</kbd>}
      {entry.keys.map((key, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="sc-hidden"> or </span>}
          <kbd className="sc-key">{key}</kbd>
        </Fragment>
      ))}
    </>
  )
}

export function ShortcutsBody() {
  const [query, setQuery] = useState('')
  const nonce = useShortcutsGate((state) => state.nonce)
  const inputRef = useRef<HTMLInputElement>(null)
  const baseId = useId()
  // Whether AI is on is read as the screen opens (the body mounts on every open).
  const [ai] = useState(aiEnabled)
  const groups = useMemo(() => shownShortcuts({ mac: IS_MAC, ai, query }), [ai, query])
  // The assistant's group is written in Herman's words: said of the chosen persona.
  const { say } = usePersona()
  const words = (group: { id: string }, text: string): string => (group.id === 'herman' ? say(text) : text)

  // Opening, or pressing Ctrl+/ again while open: the filter takes the focus, its text selected.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [nonce])

  return (
    <>
      <header className="sc-head">
        <h2 id={`${baseId}-title`}>Keyboard shortcuts</h2>
        <label className="sc-filter">
          <Search />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Filter"
            aria-label="Filter shortcuts"
            aria-controls={`${baseId}-list`}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>
      <div className="sc-body" id={`${baseId}-list`} role="region" aria-label="Shortcuts" tabIndex={0}>
        {groups.map((group) => {
          const headingId = `${baseId}-${group.id}`
          return (
            <section key={group.id} className="sc-group">
              <h3 id={headingId}>{words(group, group.title)}</h3>
              <table aria-labelledby={headingId}>
                <thead className="sc-hidden">
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Keys</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((entry) => (
                    <tr key={entry.id}>
                      <th scope="row">{words(group, entry.label)}</th>
                      <td>
                        <Keys entry={entry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )
        })}
        {groups.length === 0 && (
          <p className="sc-empty" role="status">
            No matching shortcuts
          </p>
        )}
      </div>
    </>
  )
}
