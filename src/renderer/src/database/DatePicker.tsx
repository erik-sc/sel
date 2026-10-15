import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { ChevronLeft, ChevronRight } from '@/ui/icons'
import * as L from './logic'
import { weekdayLabels } from './common'

/**
 * Month grid for picking a day or a range, each optionally at a time of day. Works on
 * `YYYY-MM-DD[THH:mm]` strings only: no value is ever round-tripped through a local-time Date.
 */
export function DatePicker({
  value,
  onChange
}: {
  value: L.DateValue | null
  onChange: (value: L.DateValue | null) => void
}): JSX.Element {
  const today = L.todayISO()
  const start = value ? L.dayKey(value.start) : null
  const end = value?.end ? L.dayKey(value.end) : null
  const [cursor, setCursor] = useState(() => L.monthOf(start ?? today))
  const startTime = value ? L.timeOf(value.start) : null
  const endTime = value?.end ? L.timeOf(value.end) : null
  const [withEnd, setWithEnd] = useState(!!end)
  const [withTime, setWithTime] = useState(!!startTime)
  const [picking, setPicking] = useState<'start' | 'end'>('start')
  const weeks = useMemo(() => L.calendarMatrix(cursor.year, cursor.month), [cursor])

  /** Writes a value; normalising drops an end that does not come after the start. */
  const commit = (next: L.DateValue): void => onChange(L.normalizeDateValue(next))
  // A picked day keeps the time of day that end of the value had.
  const at = (day: string, time: string | null): string => (withTime ? L.withTime(day, time ?? DEFAULT_TIME) : day)

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

  return (
    <div className="db-datepicker">
      <div className={withTime ? 'db-datepicker-value has-time' : 'db-datepicker-value'}>
        <span className={withEnd && picking === 'start' ? 'db-date-slot is-active' : 'db-date-slot'}>
          {start ? L.formatDay(start) : 'Start date'}
        </span>
        {withTime && start && <TimeInput label="Start time" time={startTime ?? DEFAULT_TIME} onChange={(time) => setTime('start', time)} />}
        {withEnd && (
          <>
            <span className="db-date-arrow">→</span>
            <span className={picking === 'end' ? 'db-date-slot is-active' : 'db-date-slot'}>
              {end ? L.formatDay(end) : 'End date'}
            </span>
            {withTime && end && <TimeInput label="End time" time={endTime ?? startTime ?? DEFAULT_TIME} onChange={(time) => setTime('end', time)} />}
          </>
        )}
      </div>
      <div className="db-datepicker-nav">
        <span className="db-datepicker-month">{L.monthLabel(cursor.year, cursor.month)}</span>
        <button type="button" className="db-mini-button is-text" onClick={() => setCursor(L.monthOf(L.todayISO()))}>
          Today
        </button>
        <button
          type="button"
          className="db-mini-button"
          aria-label="Previous month"
          onClick={() => setCursor((current) => L.shiftMonth(current, -1))}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="db-mini-button"
          aria-label="Next month"
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
          <span>End date</span>
        </label>
        <label className="db-check-row">
          <input type="checkbox" checked={withTime} onChange={toggleTime} />
          <span>Time</span>
        </label>
        <button
          type="button"
          className="db-mini-button is-text"
          disabled={!value}
          onClick={() => {
            onChange(null)
            setPicking('start')
            setWithTime(false)
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}

/** The time a day gets when times are switched on. */
const DEFAULT_TIME = '09:00'

/** A time of day; written when a full `HH:mm` has been typed or picked. */
function TimeInput({ label, time, onChange }: { label: string; time: string; onChange: (time: string) => void }): JSX.Element {
  return (
    <input
      type="time"
      className="ui-input db-date-time"
      aria-label={label}
      value={time}
      onChange={(event) => {
        if (L.normalizeTime(event.target.value)) onChange(event.target.value)
      }}
    />
  )
}
