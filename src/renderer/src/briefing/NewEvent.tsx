// The calendar's new event: what, when, and a button that opens Google Calendar with it filled
// in (./eventLink.ts). sel cannot write to a calendar, so the event is saved there, and shows
// here with the calendar's next refresh.
import { useId, useRef, useEffect, useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { Button } from '@/ui/Button'
import { clockPlus, googleEventUrl, newEventProblem, type NewEvent } from './eventLink'

export interface NewEventCopy {
  what: string
  whatPlaceholder: string
  day: string
  allDay: string
  from: string
  until: string
  where: string
  create: string
  hint: string
  problems: Record<'title' | 'day' | 'time', string>
}

function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export function NewEventForm({
  day,
  time,
  copy,
  onOpen,
  onCancel
}: {
  day: string
  /** The hour clicked, `HH:mm`, or null for a day. */
  time: string | null
  copy: NewEventCopy
  /** Opens the address in the browser; the form closes once it did. */
  onOpen: (url: string) => void
  onCancel: () => void
}): JSX.Element {
  const id = useId()
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(day)
  const [allDay, setAllDay] = useState(time === null)
  const [start, setStart] = useState(time ?? '09:00')
  const [end, setEnd] = useState(clockPlus(time ?? '09:00', 60))
  const [location, setLocation] = useState('')
  const [problem, setProblem] = useState<'title' | 'day' | 'time' | null>(null)
  const first = useRef<HTMLInputElement>(null)
  // The popover is shown once it has been placed: the first field can take the focus right after.
  useEffect(() => {
    const timer = setTimeout(() => first.current?.focus(), 30)
    return () => clearTimeout(timer)
  }, [])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const draft: NewEvent = { title, day: date, start: allDay ? null : start, end: allDay ? null : end, location, timeZone: timeZone() }
    const wrong = newEventProblem(draft)
    setProblem(wrong)
    const url = wrong ? null : googleEventUrl(draft)
    if (url) onOpen(url)
  }

  return (
    <form
      className="cal-event-form"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
      noValidate
    >
      <label className="cal-event-field is-wide" htmlFor={`${id}-title`}>
        <span>{copy.what}</span>
        <input
          ref={first}
          id={`${id}-title`}
          className="ui-input"
          value={title}
          maxLength={300}
          placeholder={copy.whatPlaceholder}
          aria-invalid={problem === 'title' || undefined}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="cal-event-field" htmlFor={`${id}-day`}>
        <span>{copy.day}</span>
        <input
          id={`${id}-day`}
          className="ui-input"
          type="date"
          value={date}
          aria-invalid={problem === 'day' || undefined}
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <label className="cal-event-check" htmlFor={`${id}-all`}>
        <input id={`${id}-all`} type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
        <span>{copy.allDay}</span>
      </label>
      {!allDay && (
        <>
          <label className="cal-event-field" htmlFor={`${id}-from`}>
            <span>{copy.from}</span>
            <input
              id={`${id}-from`}
              className="ui-input"
              type="time"
              value={start}
              aria-invalid={problem === 'time' || undefined}
              onChange={(event) => {
                const next = event.target.value
                // The end keeps its distance from the start while both read.
                if (/^\d\d:\d\d$/u.test(next) && /^\d\d:\d\d$/u.test(start) && /^\d\d:\d\d$/u.test(end)) {
                  const minutes = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))
                  const length = minutes(end) - minutes(start)
                  if (length > 0) setEnd(clockPlus(next, length))
                }
                setStart(next)
              }}
            />
          </label>
          <label className="cal-event-field" htmlFor={`${id}-until`}>
            <span>{copy.until}</span>
            <input
              id={`${id}-until`}
              className="ui-input"
              type="time"
              value={end}
              aria-invalid={problem === 'time' || undefined}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </>
      )}
      <label className="cal-event-field is-wide" htmlFor={`${id}-where`}>
        <span>{copy.where}</span>
        <input
          id={`${id}-where`}
          className="ui-input"
          value={location}
          maxLength={300}
          onChange={(event) => setLocation(event.target.value)}
        />
      </label>
      {problem && (
        <p className="cal-event-problem" role="alert">
          {copy.problems[problem]}
        </p>
      )}
      <div className="cal-event-actions">
        <Button type="submit" variant="primary">
          {copy.create}
        </Button>
        <p className="cal-event-hint">{copy.hint}</p>
      </div>
    </form>
  )
}
