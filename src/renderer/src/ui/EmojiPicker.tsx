import { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_EMOJIS, EMOJI_GROUPS, type EmojiEntry } from './emoji-data'

/** How many keywords of an emoji are shown as its hover title. */
const EMOJI_TITLE_WORDS = 2

export interface EmojiPickerProps {
  onPick: (emoji: string | null) => void
  /** False where something around the picker already offers to remove the icon. */
  removable?: boolean
}

function EmojiGrid({ emojis, onPick }: { emojis: EmojiEntry[]; onPick: (emoji: string) => void }) {
  return (
    <div className="ui-emoji-grid">
      {emojis.map((entry) => (
        <button
          key={entry.char}
          type="button"
          className="ui-emoji-cell"
          title={entry.keywords.split(' ').slice(0, EMOJI_TITLE_WORDS).join(' ')}
          onClick={() => onPick(entry.char)}
        >
          {entry.char}
        </button>
      ))}
    </div>
  )
}

export function EmojiPicker({ onPick, removable = true }: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return null
    return ALL_EMOJIS.filter((entry) => terms.every((t) => entry.keywords.includes(t) || entry.char === t))
  }, [query])

  const pickRandom = (): void => {
    onPick(ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)].char)
  }

  return (
    <div className="ui-emoji-picker">
      <div className="ui-emoji-toolbar">
        <input
          ref={inputRef}
          className="ui-input"
          placeholder="Filter…"
          aria-label="Filter emoji"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Enter that confirms an IME composition is not a choice.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && results?.length) {
              event.preventDefault()
              onPick(results[0].char)
            }
          }}
        />
        <button type="button" className="ui-button is-ghost" onClick={pickRandom}>
          Random
        </button>
        {removable && (
          <button type="button" className="ui-button is-ghost" onClick={() => onPick(null)}>
            Remove
          </button>
        )}
      </div>
      <div className="ui-emoji-scroll">
        {results ? (
          results.length ? (
            <EmojiGrid emojis={results} onPick={onPick} />
          ) : (
            <div className="ui-emoji-empty">No emoji found</div>
          )
        ) : (
          EMOJI_GROUPS.map((group) => (
            <section key={group.name}>
              <div className="ui-emoji-group">{group.name}</div>
              <EmojiGrid emojis={group.emojis} onPick={onPick} />
            </section>
          ))
        )}
      </div>
    </div>
  )
}
