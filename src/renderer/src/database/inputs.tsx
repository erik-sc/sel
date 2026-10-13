// Small text inputs of the database chrome (title, view name).
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import * as L from './logic'
import { useCommitOnUnmount, useEscapePressed } from './hooks'

/** Input bound to a store value: edits locally, commits on blur / Enter / unmount, Escape reverts. */
export function TitleInput({
  value,
  className,
  placeholder,
  label,
  onCommit
}: {
  value: string
  className: string
  placeholder: string
  label: string
  onCommit: (value: string) => void
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  useCommitOnUnmount(() => {
    if (draft !== null && draft !== value) onCommit(draft)
  })
  return (
    <input
      className={className}
      value={draft ?? value}
      placeholder={placeholder}
      aria-label={label}
      maxLength={L.MAX_TEXT_LENGTH}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          // Revert first; the blur that follows then has nothing to commit.
          setDraft(null)
          const el = event.currentTarget
          setTimeout(() => el.blur(), 0)
        }
      }}
    />
  )
}

/**
 * Name field shown inside a popover. Enter, blur and closing the popover by
 * clicking elsewhere save; Escape cancels.
 */
export function RenameInput({
  value,
  label,
  onCommit,
  onDone
}: {
  value: string
  label: string
  onCommit: (value: string) => void
  onDone: () => void
}): JSX.Element {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const escaped = useEscapePressed(ref)
  const done = useRef(false)
  const commit = (): void => {
    if (done.current) return
    done.current = true
    if (L.cleanName(text) && text !== value) onCommit(text)
  }
  useCommitOnUnmount(() => {
    if (!escaped.current) commit()
  })
  return (
    <div className="db-prop-menu-name">
      <input
        ref={ref}
        className="ui-input"
        autoFocus
        value={text}
        aria-label={label}
        maxLength={L.MAX_NAME_LENGTH}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          commit()
          onDone()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          commit()
          onDone()
        }}
      />
    </div>
  )
}
