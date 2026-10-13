import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { ChevronLeft, ChevronRight } from '@/ui/icons'
import * as L from './logic'
import { weekdayLabels } from './common'

/**
 * Month grid for picking a day or a range. Works on `YYYY-MM-DD` strings only:
 * no value is ever round-tripped through a local-time Date.
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
  const [withEnd, setWithEnd] = useState(!!end)
  const [picking, setPicking] = useState<'start' | 'end'>('start')
  const weeks = useMemo(() => L.calendarMatrix(cursor.year, cursor.month), [cursor])

  const pickDay = (day: string): void => {
    if (!withEnd) {
      onChange({ start: day })
      return
    }
    if (!start || picking === 'start') {
      onChange(end && end > day ? { start: day, end } : { start: day })
      setPicking('end')
      return
    }
    if (day === start) onChange({ start })
    else onChange(day < start ? { start: day, end: start } : { start, end: day })
    setPicking('start')
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
      <div className="db-datepicker-value">
        <span className={withEnd && picking === 'start' ? 'db-date-slot is-active' : 'db-date-slot'}>
          {start ? L.formatDay(start) : 'Start date'}
        </span>
        {withEnd && (
          <>
            <span className="db-date-arrow">→</span>
            <span className={picking === 'end' ? 'db-date-slot is-active' : 'db-date-slot'}>
              {end ? L.formatDay(end) : 'End date'}
            </span>
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
        <button
          type="button"
          className="db-mini-button is-text"
          disabled={!value}
          onClick={() => {
            onChange(null)
            setPicking('start')
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
