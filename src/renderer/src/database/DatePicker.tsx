import { useEffect, useId, useMemo, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { clockOf, parseDate, quickDate, stepTime, type QuickDate } from '@shared/tasks/dates'
import { REMINDER_SHORTCUTS, reminderAt } from '@shared/tasks/remind'
import { useHome } from '@/home/store'
import { localeDayFirst } from '@/tasks/addTask'
import { ChevronLeft, ChevronRight } from '@/ui/icons'
import * as L from './logic'
import { weekdayLabels } from './common'
import { DATE_COPY, type DateCopy } from './dateCopy'

const QUICK: readonly QuickDate[] = ['today', 'tomorrow', 'weekend', 'nextWeek']
const DAY_FIRST = localeDayFirst()

export function useDateCopy(): DateCopy {
  return DATE_COPY[useHome((state) => state.locale)]
}

/**
 * Month grid for picking a day or a range, each optionally at a time of day. Works on
 * `YYYY-MM-DD[THH:mm]` strings only: no value is ever round-tripped through a local-time Date.
 * On top: a field that reads a date in words, as the quick add does ("sex 15h", "next monday"),
 * and quick choices. With `reminderFor` (the due date of the task it reminds about), relative
 * reminders too: they are worked out from it and written as the moment they mean.
 */
export function DatePicker({
  value,
  onChange,
  reminderFor
}: {
  value: L.DateValue | null
  onChange: (value: L.DateValue | null) => void
  reminderFor?: string | null
}): JSX.Element {
  const copy = useDateCopy()
  const today = L.todayISO()
  const start = value ? L.dayKey(value.start) : null
  const end = value?.end ? L.dayKey(value.end) : null
  const [cursor, setCursor] = useState(() => L.monthOf(start ?? today))
  const startTime = value ? L.timeOf(value.start) : null
  const endTime = value?.end ? L.timeOf(value.end) : null
  const [withEnd, setWithEnd] = useState(!!end)
  const [withTime, setWithTime] = useState(!!startTime)
  const [picking, setPicking] = useState<'start' | 'end'>('start')
  const [text, setText] = useState('')
  const weeks = useMemo(() => L.calendarMatrix(cursor.year, cursor.month), [cursor])
  const typed = useMemo(() => (text.trim() ? parseDate(text, { now: new Date(), dayFirst: DAY_FIRST }) : null), [text])

  /** Writes a value; normalising drops an end that does not come after the start. */
  const commit = (next: L.DateValue): void => onChange(L.normalizeDateValue(next))
  // A picked day keeps the time of day that end of the value had.
  const at = (day: string, time: string | null): string => (withTime ? L.withTime(day, time ?? DEFAULT_TIME) : day)

  /** One moment, from the field, a quick choice or a reminder: the start, keeping an end that still follows it. */
  const place = (moment: string): void => {
    const day = L.dayKey(moment)
    if (!day) return
    const time = L.timeOf(moment)
    if (time) setWithTime(true)
    const startAt = time ? moment : at(day, startTime)
    commit(withEnd && end && end >= day ? { start: startAt, end: at(end, endTime) } : { start: startAt })
    setCursor(L.monthOf(day))
    setPicking(withEnd ? 'end' : 'start')
  }

  const pickDay = (day: string): void => {
    if (!withEnd) {
      commit({ start: at(day, startTime) })
      return
    }
    if (!start || picking === 'start') {
      commit(end && end >= day ? { start: at(day, startTime), end: at(end, endTime) } : { start: at(day, startTime) })
      setPicking('end')
      return
    }
    if (day === start && !withTime) commit({ start: at(start, startTime) })
    else if (day < start) commit({ start: at(day, startTime), end: at(start, endTime ?? startTime) })
    else commit({ start: at(start, startTime), end: at(day, endTime ?? startTime) })
    setPicking('start')
  }

  const setTime = (which: 'start' | 'end', time: string): void => {
    const clean = L.normalizeTime(time)
    if (!clean || !start) return
    if (which === 'start') commit({ start: L.withTime(start, clean), end: end ? L.withTime(end, endTime) : undefined })
    else if (end) commit({ start: L.withTime(start, startTime), end: L.withTime(end, clean) })
  }

  const toggleTime = (): void => {
    const next = !withTime
    setWithTime(next)
    if (!start) return
    if (next) commit({ start: L.withTime(start, DEFAULT_TIME), end: end ? L.withTime(end, DEFAULT_TIME) : undefined })
    else commit({ start, end: end ?? undefined })
  }

  const toggleEnd = (): void => {
    if (withEnd) {
      setWithEnd(false)
      setPicking('start')
      if (start && end) onChange({ start })
    } else {
      setWithEnd(true)
      setPicking(start ? 'end' : 'start')
    }
  }

  const clear = (): void => {
    onChange(null)
    setPicking('start')
    setWithTime(false)
  }

  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!typed?.date) return
    place(typed.date)
    setText('')
  }

  const remindAt = (shortcut: (typeof REMINDER_SHORTCUTS)[number]): string | null =>
    reminderFor ? reminderAt(reminderFor, shortcut) : null
  const current = value && !value.end ? L.normalizeMoment(value.start) : null

  return (
    <div className="db-datepicker">
      <div className="db-datepicker-field">
        <input
          className="ui-input db-datepicker-text"
          value={text}
          placeholder={copy.fieldPlaceholder}
          aria-label={copy.fieldLabel}
          aria-describedby={text.trim() ? 'db-datepicker-preview' : undefined}
          spellCheck={false}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onFieldKey}
        />
        {text.trim() && (
          <span
            id="db-datepicker-preview"
            className={typed?.date ? 'db-datepicker-preview' : 'db-datepicker-preview is-unknown'}
            aria-live="polite"
          >
            {typed?.date ? `↵ ${L.formatMoment(typed.date)}` : copy.notUnderstood}
          </span>
        )}
      </div>
      {reminderFor !== undefined && (
        <div className="db-datepicker-quick" role="group" aria-label={copy.reminders}>
          {REMINDER_SHORTCUTS.map((shortcut) => {
            const moment = remindAt(shortcut)
            return (
              <button
                key={shortcut}
                type="button"
                className="db-quick-choice"
                disabled={!moment}
                title={moment ? L.formatMoment(moment) : reminderFor ? copy.reminderNeedsTime : copy.reminderNeedsDue}
                aria-pressed={!!moment && moment === current}
                onClick={() => moment && place(moment)}
              >
                {copy.reminder[shortcut]}
              </button>
            )
          })}
        </div>
      )}
      <div className="db-datepicker-quick" role="group" aria-label={copy.fieldLabel}>
        {QUICK.map((choice) => {
          const day = quickDate(choice)
          return (
            <button
              key={choice}
              type="button"
              className="db-quick-choice"
              title={L.formatDay(day)}
              aria-pressed={start === day && !end}
              onClick={() => place(day)}
            >
              {copy.quick[choice]}
            </button>
          )
        })}
        <button type="button" className="db-quick-choice" disabled={!value} onClick={clear}>
          {copy.quick.none}
        </button>
      </div>
      <div className={withTime ? 'db-datepicker-value has-time' : 'db-datepicker-value'}>
        <span className={withEnd && picking === 'start' ? 'db-date-slot is-active' : 'db-date-slot'}>
          {start ? L.formatDay(start) : copy.startDate}
        </span>
        {withTime && start && (
          <TimeInput
            label={copy.startTime}
            hint={copy.timeHint}
            time={startTime ?? DEFAULT_TIME}
            onChange={(time) => setTime('start', time)}
          />
        )}
        {withEnd && (
          <>
            <span className="db-date-arrow">→</span>
            <span className={picking === 'end' ? 'db-date-slot is-active' : 'db-date-slot'}>{end ? L.formatDay(end) : copy.endDate}</span>
            {withTime && end && (
              <TimeInput
                label={copy.endTime}
                hint={copy.timeHint}
                time={endTime ?? startTime ?? DEFAULT_TIME}
                onChange={(time) => setTime('end', time)}
              />
            )}
          </>
        )}
      </div>
      <div className="db-datepicker-nav">
        <span className="db-datepicker-month">{L.monthLabel(cursor.year, cursor.month)}</span>
        <button
          type="button"
          className="db-mini-button"
          aria-label={copy.previousMonth}
          onClick={() => setCursor((current) => L.shiftMonth(current, -1))}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="db-mini-button"
          aria-label={copy.nextMonth}
          onClick={() => setCursor((current) => L.shiftMonth(current, 1))}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="db-datepicker-grid">
        {weekdayLabels().map((label, index) => (
          <span key={index} className="db-datepicker-weekday">
            {label}
          </span>
        ))}
        {weeks.flat().map((day) => {
          const classes = ['db-datepicker-day']
          if (!day.inMonth) classes.push('is-outside')
          if (day.date === today) classes.push('is-today')
          if (day.date === start || day.date === end) classes.push('is-selected')
          else if (start && end && day.date > start && day.date < end) classes.push('is-in-range')
          return (
            <button
              type="button"
              key={day.date}
              className={classes.join(' ')}
              aria-label={L.formatDay(day.date)}
              aria-pressed={day.date === start || day.date === end}
              onClick={() => pickDay(day.date)}
            >
              {day.day}
            </button>
          )
        })}
      </div>
      <div className="db-datepicker-footer">
        <label className="db-check-row">
          <input type="checkbox" checked={withEnd} onChange={toggleEnd} />
          <span>{copy.endToggle}</span>
        </label>
        <label className="db-check-row">
          <input type="checkbox" checked={withTime} onChange={toggleTime} />
          <span>{copy.timeToggle}</span>
        </label>
        <button type="button" className="db-mini-button is-text" disabled={!value} onClick={clear}>
          {copy.clear}
        </button>
      </div>
    </div>
  )
}

/** The time a day gets when times are switched on. */
const DEFAULT_TIME = '09:00'
/** Every quarter of an hour, offered while typing a time. */
const QUARTERS = Array.from({ length: 96 }, (_, index) => stepTime('00:00', index))

/**
 * A time of day typed as text ("9", "9h30", "14:15", "2pm") or picked from the quarters of an
 * hour; ↑ and ↓ move it by 15 minutes. Written on Enter, on leaving the field and on each step.
 */
function TimeInput({
  label,
  hint,
  time,
  onChange
}: {
  label: string
  hint: string
  time: string
  onChange: (time: string) => void
}): JSX.Element {
  const listId = useId()
  const [draft, setDraft] = useState(time)
  useEffect(() => setDraft(time), [time])

  const write = (): void => {
    const clean = clockOf(draft) ?? L.normalizeTime(draft)
    if (clean && clean !== time) onChange(clean)
    else setDraft(time)
  }

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        className="ui-input db-date-time"
        aria-label={label}
        title={hint}
        value={draft}
        list={listId}
        maxLength={8}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value)
          // A pick from the list is a whole time: written at once.
          if (QUARTERS.includes(event.target.value) && event.target.value !== time) onChange(event.target.value)
        }}
        onBlur={write}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            write()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const next = stepTime(clockOf(draft) ?? time, event.key === 'ArrowUp' ? 1 : -1)
            setDraft(next)
            onChange(next)
          }
        }}
      />
      <datalist id={listId}>
        {QUARTERS.map((quarter) => (
          <option key={quarter} value={quarter} />
        ))}
      </datalist>
    </>
  )
}
