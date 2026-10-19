// The quick-add input: one line ("Pagar aluguel amanhã 9h p1 #Casa") becomes a task. What the
// parser recognises is highlighted while typing; a click on a highlight, or Backspace right after
// one, keeps those words as text. `#` and `@` offer the projects and labels there are, and make
// a new one on Enter. Used by the Tasks screen (and by anything else that wants to add a task).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { SelectOption } from '@shared/types'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { parseTask, type ParsedTask, type ParsedToken } from '@shared/tasks/parse'
import * as actions from '@/database/actions'
import * as L from '@/database/logic'
import { useTasksGate, type TaskListKey } from './gate'
import { dueLabel } from './lists'
import { findOption, fragmentAt, listDefaults, localeDayFirst, shiftIgnored, suggest, taskValues, type IgnoredSpan } from './addTask'

const DAY_FIRST = localeDayFirst()

/** The last focus request served: a request made before the screen loaded is served once it mounts. */
let servedFocus = 0

const KIND_LABEL: Record<ParsedToken['kind'], string> = {
  date: 'date',
  time: 'time',
  recurrence: 'repeat',
  priority: 'priority',
  project: 'project',
  label: 'label',
  remind: 'reminder'
}

/** The fields a line will set, in words, under the input. */
function summary(parsed: ParsedTask, today: string): string[] {
  const parts: string[] = []
  if (parsed.due) parts.push(dueLabel(parsed.due, today).text)
  if (parsed.recurrence) parts.push(`↻ ${parsed.recurrence.text}${parsed.recurrence.from === 'completion' ? ' (from completion)' : ''}`)
  if (parsed.priority) parts.push(`P${parsed.priority}`)
  if (parsed.project) parts.push(`#${parsed.project}`)
  for (const label of parsed.labels) parts.push(`@${label}`)
  if (parsed.remind) parts.push(`⏰ ${dueLabel(parsed.remind, today).text}`)
  return parts
}

export interface QuickAddProps {
  /** The list it adds to: Today adds today's date, a project its project. */
  list: TaskListKey
  today: string
  projects: readonly SelectOption[]
  labels: readonly SelectOption[]
  autoFocus?: boolean
  onAdded?: (id: string) => void
  /** Escape on an empty input. */
  onCancel?: () => void
}

export function QuickAdd(props: QuickAddProps): JSX.Element {
  const { list, today, projects, labels, autoFocus, onAdded, onCancel } = props
  const [value, setValue] = useState('')
  const [ignored, setIgnored] = useState<IgnoredSpan[]>([])
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [closed, setClosed] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const focus = useTasksGate((state) => state.focus)

  useEffect(() => {
    if (focus === servedFocus) return
    servedFocus = focus
    input.current?.focus()
  }, [focus])

  const projectNames = useMemo(() => projects.map((option) => option.name), [projects])
  const labelNames = useMemo(() => labels.map((option) => option.name), [labels])
  const parsed = useMemo(
    // `today` is a dependency so that the words are read again after midnight.
    () => (void today, parseTask(value, { now: new Date(), dayFirst: DAY_FIRST, projects: projectNames, labels: labelNames, ignored })),
    [value, today, projectNames, labelNames, ignored]
  )

  // The `#…` / `@…` being typed, and what it could be.
  const fragment = closed ? null : fragmentAt(value, caret)
  const pool = fragment?.sigil === '#' ? projects : labels
  const matches = fragment ? suggest(pool, fragment.text) : []
  const canCreate = !!fragment && fragment.text.trim() !== '' && !findOption(pool, fragment.text)
  const choices: { option?: SelectOption; create?: string }[] = [
    ...matches.map((option) => ({ option })),
    ...(canCreate ? [{ create: fragment.text.trim() }] : [])
  ]
  const open = !!fragment && choices.length > 0

  const sync = (): void => {
    const el = input.current
    if (!el) return
    setCaret(el.selectionStart ?? el.value.length)
    if (mirror.current) mirror.current.scrollLeft = el.scrollLeft
  }
  useEffect(sync, [value])

  const change = (next: string): void => {
    setIgnored((current) => shiftIgnored(current, value, next))
    setValue(next)
    setActive(0)
    setClosed(false)
  }

  const ignore = (token: ParsedToken): void => {
    setIgnored((current) => [...current, { start: token.start, text: token.text }])
    input.current?.focus()
  }

  /** Puts a project or label in place of what was typed after `#` / `@`. */
  const choose = (choice: { option?: SelectOption; create?: string }): void => {
    if (!fragment) return
    let name = choice.option?.name ?? choice.create ?? ''
    if (choice.create) {
      const property = fragment.sigil === '#' ? TASK_PROPS.project : TASK_PROPS.labels
      const id = actions.addOption(TASKS_DATABASE_ID, property, name)
      const made = id
        ? L.optionsOf(L.propOf(actions.snapshot(TASKS_DATABASE_ID).schema, property)).find((option) => option.id === id)
        : undefined
      name = made?.name ?? name
    }
    const next = `${value.slice(0, fragment.start)}${fragment.sigil}${name} ${value.slice(caret)}`
    const at = fragment.start + name.length + 2
    change(next)
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(at, at)
      sync()
    })
  }

  const submit = (): void => {
    if (!parsed.title) return
    const schema = actions.snapshot(TASKS_DATABASE_ID).schema
    const optionId = (property: string, name: string): string | null => {
      const existing = findOption(L.optionsOf(L.propOf(schema, property)), name)
      return existing?.id ?? actions.addOption(TASKS_DATABASE_ID, property, name) ?? null
    }
    const project = parsed.project ? optionId(TASK_PROPS.project, parsed.project) : null
    const labelIds = parsed.labels.map((name) => optionId(TASK_PROPS.labels, name)).filter((id): id is string => !!id)
    const id = actions.createRow(TASKS_DATABASE_ID, {
      title: parsed.title,
      values: taskValues(parsed, { project, labels: labelIds }, listDefaults(list, today))
    })
    setValue('')
    setIgnored([])
    onAdded?.(id)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        choose(choices[Math.min(active, choices.length - 1)])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setClosed(true)
        return
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (value) {
        change('')
        setIgnored([])
      } else {
        input.current?.blur()
        onCancel?.()
      }
      return
    }
    // Backspace right after a highlight takes the highlight away first; the next one deletes.
    if (event.key === 'Backspace') {
      const el = event.currentTarget
      if (el.selectionStart !== el.selectionEnd) return
      const token = parsed.tokens.find((t) => t.end === el.selectionStart)
      if (token) {
        event.preventDefault()
        ignore(token)
      }
    }
  }

  // The mirror: the same text, with the recognised spans marked, laid over the input.
  const segments: JSX.Element[] = []
  let at = 0
  for (const token of parsed.tokens) {
    if (token.start > at) segments.push(<span key={`t${at}`}>{value.slice(at, token.start)}</span>)
    segments.push(
      <mark
        key={`m${token.start}`}
        className={`qa-token is-${token.kind}`}
        title={`Recognised as a ${KIND_LABEL[token.kind]}. Click to keep it as text.`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => ignore(token)}
      >
        {token.text}
      </mark>
    )
    at = token.end
  }
  if (at < value.length) segments.push(<span key={`t${at}`}>{value.slice(at)}</span>)

  const fields = summary(parsed, today)

  return (
    <div className="qa">
      <div className="qa-row">
        <span className="qa-plus" aria-hidden="true">
          +
        </span>
        <div className="qa-field">
          <input
            ref={input}
            className="qa-input"
            value={value}
            placeholder="Add a task: Pay rent tomorrow 9am p1 #Home"
            aria-label="Add a task"
            role="combobox"
            aria-expanded={open}
            aria-controls="qa-suggestions"
            aria-autocomplete="list"
            maxLength={500}
            autoFocus={autoFocus}
            spellCheck={false}
            onChange={(event) => change(event.target.value)}
            onKeyDown={onKeyDown}
            onSelect={sync}
            onScroll={sync}
            onBlur={() => setClosed(true)}
            onFocus={() => setClosed(false)}
          />
          <div ref={mirror} className="qa-mirror" aria-hidden="true">
            {segments}
          </div>
        </div>
      </div>
      {fields.length > 0 && (
        <div className="qa-summary" aria-live="polite">
          {fields.join(' · ')}
        </div>
      )}
      {open && (
        <ul id="qa-suggestions" className="qa-suggestions" role="listbox">
          {choices.map((choice, index) => (
            <li
              key={choice.option?.id ?? `create:${choice.create}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'qa-suggestion is-active' : 'qa-suggestion'}
              onMouseDown={(event) => {
                event.preventDefault()
                choose(choice)
              }}
              onMouseEnter={() => setActive(index)}
            >
              {choice.option ? (
                <>
                  <span className="qa-suggestion-dot" style={{ background: `var(--c-${choice.option.color})` }} aria-hidden="true" />
                  {fragment?.sigil}
                  {choice.option.name}
                </>
              ) : (
                <>
                  Create {fragment?.sigil === '#' ? 'project' : 'label'} “{choice.create}”
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
