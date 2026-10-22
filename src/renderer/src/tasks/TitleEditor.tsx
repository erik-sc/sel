// A task's name, edited where it is shown (a row, the task panel). The words are read as the quick
// add reads them, with the same highlights: "Call mum amanhã p1" leaves "Call mum", due tomorrow,
// at P1. A click on a highlight, or Backspace right after one, keeps those words as text. Enter
// saves, Escape puts the old name back; leaving the field saves.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ParsedTask, ParsedToken } from '@shared/tasks/parse'
import { parseTask } from '@shared/tasks/parse'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { useBlock } from '@/store/blocks'
import { useHome } from '@/home/store'
import * as L from '@/database/logic'
import { localeDayFirst, shiftIgnored, type IgnoredSpan } from './addTask'
import { TASK_COPY } from './copy'
import { dueLabel } from './lists'

const DAY_FIRST = localeDayFirst()

/** What a line will set besides the name, in words. */
function fields(parsed: ParsedTask, today: string, words: (typeof TASK_COPY)['en']): string[] {
  const parts: string[] = []
  if (parsed.due) parts.push(dueLabel(parsed.due, today, undefined, words.days).text)
  if (parsed.recurrence) parts.push(`↻ ${parsed.recurrence.text}`)
  if (parsed.priority) parts.push(`P${parsed.priority}`)
  if (parsed.project) parts.push(`#${parsed.project}`)
  for (const label of parsed.labels) parts.push(`@${label}`)
  if (parsed.remind) parts.push(`⏰ ${dueLabel(parsed.remind, today, undefined, words.days).text}`)
  return parts
}

export interface TitleEditorProps {
  initial: string
  today: string
  /** The typed line, with what was kept as text. Called once: on Enter, or when the field is left. */
  onCommit: (text: string, ignored: readonly IgnoredSpan[]) => void
  onCancel: () => void
  className?: string
}

/** The names of the projects and labels there are, so that `#Two words` is read whole. */
function useTaskNames(): { projects: string[]; labels: string[] } {
  const database = useBlock(TASKS_DATABASE_ID)
  return useMemo(() => {
    const schema = L.normalizeDatabase(database).schema
    const names = (id: string): string[] => L.optionsOf(L.propOf(schema, id)).map((option) => option.name)
    return { projects: names(TASK_PROPS.project), labels: names(TASK_PROPS.labels) }
  }, [database])
}

export function TitleEditor({ initial, today, onCommit, onCancel, className }: TitleEditorProps): JSX.Element {
  const words = TASK_COPY[useHome((state) => state.locale)]
  const { projects, labels } = useTaskNames()
  const [value, setValue] = useState(initial)
  const [ignored, setIgnored] = useState<IgnoredSpan[]>([])
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const done = useRef(false)
  const hintId = useId()

  const parsed = useMemo(
    () => (void today, parseTask(value, { now: new Date(), dayFirst: DAY_FIRST, projects, labels, ignored })),
    [value, today, projects, labels, ignored]
  )

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  const syncScroll = (): void => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft
  }

  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && value.trim() && value !== initial) onCommit(value, ignored)
    else onCancel()
  }

  const ignore = (token: ParsedToken): void => {
    setIgnored((current) => [...current, { start: token.start, text: token.text }])
    input.current?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    // The row's keys are not for a field being typed in.
    event.stopPropagation()
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    } else if (event.key === 'Backspace') {
      const el = event.currentTarget
      if (el.selectionStart !== el.selectionEnd) return
      const token = parsed.tokens.find((t) => t.end === el.selectionStart)
      if (token) {
        event.preventDefault()
        ignore(token)
      }
    }
  }

  const segments: JSX.Element[] = []
  let at = 0
  for (const token of parsed.tokens) {
    if (token.start > at) segments.push(<span key={`t${at}`}>{value.slice(at, token.start)}</span>)
    segments.push(
      <mark
        key={`m${token.start}`}
        className={`qa-token is-${token.kind}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => ignore(token)}
      >
        {token.text}
      </mark>
    )
    at = token.end
  }
  if (at < value.length) segments.push(<span key={`t${at}`}>{value.slice(at)}</span>)
  const summary = fields(parsed, today, words)

  return (
    <span className={className ? `task-title-edit ${className}` : 'task-title-edit'}>
      <span className="qa-field">
        <input
          ref={input}
          className="qa-input"
          value={value}
          aria-label={words.renameLabel}
          aria-describedby={hintId}
          maxLength={500}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value
            setIgnored((current) => shiftIgnored(current, value, next))
            setValue(next)
          }}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          onSelect={syncScroll}
          onBlur={() => finish(true)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        />
        <div ref={mirror} className="qa-mirror" aria-hidden="true">
          {segments}
        </div>
      </span>
      <span id={hintId} className="task-title-hint" aria-live="polite">
        {summary.length ? words.willSet(summary) : words.renameHint}
      </span>
    </span>
  )
}
