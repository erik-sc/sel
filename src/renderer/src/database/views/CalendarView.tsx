import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import type { PropertySchema } from '@shared/types'
import { ChevronLeft, ChevronRight, Plus } from '@/ui/icons'
import { a11yCopy, announce } from '@/a11y/announce'
import { takeMenuKey } from '@/a11y/keys'
import * as L from '../logic'
import * as actions from '../actions'
import { RowIcon, RowTitleInput, beginDrag, draggedOf, endDrag, rowTitle, weekdayLabels, type ViewProps } from '../common'

/** How far a day key goes: a day sideways, a week up or down. */
const DAY_STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

function monthKey(day: string): string {
  return day.slice(0, 7)
}

export function CalendarView(p: ViewProps): JSX.Element {
  const { databaseId, schema, view, rows, editingRowId, setEditingRowId } = p
  const dateProp: PropertySchema | undefined = L.groupProperty(view, schema)
  const [cursor, setCursor] = useState(() => L.monthOf(L.todayISO()))
  const [dropDay, setDropDay] = useState<string | null>(null)
  // The day the keyboard is on: the grid's one Tab stop. Its events can be reached with Tab.
  const [focusDay, setFocusDay] = useState(() => L.todayISO())
  const weeks = useMemo(() => L.calendarMatrix(cursor.year, cursor.month), [cursor])
  const byDay = useMemo(() => L.rowsByDay(rows, dateProp), [rows, dateProp])
  const undated = useMemo(() => (dateProp ? rows.filter((row) => !L.dayKey(L.getCellValue(row, dateProp))).length : 0), [rows, dateProp])
  const today = L.todayISO()
  const rootRef = useRef<HTMLDivElement>(null)
  // A day or an event to focus once it is drawn (after a move, or a step into another month).
  const pendingFocus = useRef<{ day: string; event?: string } | null>(null)

  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    const selector = pending.event ? `[data-event-id="${CSS.escape(pending.event)}"]` : `[data-day="${pending.day}"]`
    const el = rootRef.current?.querySelector<HTMLElement>(selector)
    if (!el) return
    pendingFocus.current = null
    el.focus()
  })

  if (!dateProp) {
    return (
      <div className="db-empty-state">
        <p>A calendar places rows by a date property.</p>
        <button
          type="button"
          className="ui-button"
          onClick={() => actions.addProperty(databaseId, 'date', view.id, 'Date', { groupView: true })}
        >
          <Plus size={14} /> Add a Date property
        </button>
      </div>
    )
  }

  const days = weeks.flat()
  // The Tab stop is the focused day when this month shows it, else today, else the 1st.
  const stopDay = days.some((d) => d.date === focusDay)
    ? focusDay
    : (days.find((d) => d.date === today)?.date ?? days.find((d) => d.inMonth)?.date ?? days[0]?.date)

  const shift = (delta: number): void => setCursor((current) => L.shiftMonth(current, delta))

  /** Moves the keyboard to `day`, turning the month when it is not on the page. */
  const goToDay = (day: string, event?: string): void => {
    setFocusDay(day)
    pendingFocus.current = { day, event }
    if (!days.some((d) => d.date === day)) setCursor(L.monthOf(day))
    else if (!event) rootRef.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus()
  }

  const moveEvent = (rowId: string, day: string): void => {
    // Day strings only, computed from the value in the store at the time of the move.
    actions.updateCell(rowId, dateProp, (current) => (L.isDateValue(current) ? L.shiftDateValue(current, day) : { start: day }))
  }

  const dropOn = (day: string): void => {
    const dragged = draggedOf('event', databaseId)
    setDropDay(null)
    if (!dragged) return
    endDrag()
    moveEvent(dragged.id, day)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (event.nativeEvent.isComposing) return
    const eventId = target.dataset.eventId
    const day = target.dataset.day ?? target.closest<HTMLElement>('[data-day]')?.dataset.day
    if (!day || (!eventId && !target.dataset.day)) return
    let handled = true
    if (eventId) {
      const items = byDay.get(day) ?? []
      const at = items.findIndex((row) => row.id === eventId)
      if (takeMenuKey(event)) p.onRowMenu(event, eventId, target)
      else if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.key in DAY_STEP) {
        const to = L.addDays(day, DAY_STEP[event.key])
        moveEvent(eventId, to)
        goToDay(to, eventId)
        announce(a11yCopy().eventMoved(L.formatDay(to)))
      } else if (event.key === 'Enter' && !event.altKey && !event.shiftKey) p.onOpen(eventId, event)
      else if (event.ctrlKey || event.altKey || event.metaKey) handled = false
      else if (event.key === 'ArrowUp' && at > 0) focusEvent(items[at - 1].id)
      else if (event.key === 'ArrowDown' && at < items.length - 1) focusEvent(items[at + 1].id)
      else if (event.key === 'Escape') goToDay(day)
      else handled = false
    } else if (event.ctrlKey || event.altKey || event.metaKey) {
      handled = false
    } else if (event.key in DAY_STEP) {
      goToDay(L.addDays(day, DAY_STEP[event.key]))
    } else if (event.key === 'Home' || event.key === 'End') {
      const index = days.findIndex((d) => d.date === day)
      const start = index - (index % 7)
      goToDay(days[event.key === 'Home' ? start : start + 6].date)
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const month = L.shiftMonth(L.monthOf(day), event.key === 'PageUp' ? -1 : 1)
      const first = `${month.year}-${String(month.month + 1).padStart(2, '0')}-01`
      // The same day of the month, or the last one the month has.
      const wanted = L.addDays(first, Number(day.slice(8)) - 1)
      goToDay(monthKey(wanted) === monthKey(first) ? wanted : L.addDays(`${monthKey(L.addDays(first, 31))}-01`, -1))
    } else if (event.key === 'Enter' || event.key === ' ') {
      p.onNewRow({ values: { [dateProp.id]: { start: day } } })
    } else handled = false
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const focusEvent = (id: string): void => {
    rootRef.current?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`)?.focus()
  }

  return (
    <div className="db-calendar" ref={rootRef}>
      <div className="db-calendar-head">
        <span className="db-calendar-month">{L.monthLabel(cursor.year, cursor.month)}</span>
        {undated > 0 && (
          <span className="db-calendar-note">
            {undated} without {dateProp.name}
          </span>
        )}
        <span className="db-spacer" />
        <button type="button" className="db-mini-button" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="db-mini-button is-text" onClick={() => setCursor(L.monthOf(L.todayISO()))}>
          Today
        </button>
        <button type="button" className="db-mini-button" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="db-calendar-grid is-weekdays" aria-hidden="true">
        {weekdayLabels().map((label, index) => (
          <div key={index} className="db-calendar-weekday">
            {label}
          </div>
        ))}
      </div>
      <div
        className="db-calendar-grid"
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const day = (event.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day
          if (day && day !== focusDay) setFocusDay(day)
        }}
      >
        {days.map((day) => {
          const classes = ['db-calendar-day']
          if (!day.inMonth) classes.push('is-outside')
          if (day.date === today) classes.push('is-today')
          if (dropDay === day.date) classes.push('is-drop-target')
          const items = byDay.get(day.date) ?? []
          const current = day.date === stopDay
          return (
            <div
              key={day.date}
              className={classes.join(' ')}
              data-day={day.date}
              // A list of its events; a day without any is only a place to add one.
              role={items.length ? 'list' : 'group'}
              aria-label={L.formatDay(day.date)}
              aria-current={day.date === today ? 'date' : undefined}
              tabIndex={current ? 0 : -1}
              onClick={(event) => {
                // Only clicks on the empty part of the day create a row.
                if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest('.db-calendar-day-head')) {
                  return
                }
                p.onNewRow({ values: { [dateProp.id]: { start: day.date } } })
              }}
              onDragOver={(event) => {
                if (!draggedOf('event', databaseId)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropDay((prev) => (prev === day.date ? prev : day.date))
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropDay((prev) => (prev === day.date ? null : prev))
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                dropOn(day.date)
              }}
            >
              <div className="db-calendar-day-head" aria-hidden="true">
                <span className="db-calendar-add">
                  <Plus size={12} />
                </span>
                <span className="db-calendar-day-number">{day.day}</span>
              </div>
              {items.map((row) => {
                const editing = editingRowId === row.id
                const title = rowTitle(row)
                return (
                  <div
                    key={row.id}
                    className="db-calendar-item"
                    data-event-id={row.id}
                    role="listitem"
                    tabIndex={current ? 0 : -1}
                    draggable={!editing}
                    title={title}
                    onDragStart={(event) => beginDrag(event, { kind: 'event', id: row.id, databaseId })}
                    onDragEnd={() => {
                      endDrag()
                      setDropDay(null)
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (!editing) p.onOpen(row.id, event)
                    }}
                    onAuxClick={(event) => {
                      if (event.button === 1) p.onOpen(row.id, { button: 1 })
                    }}
                    onContextMenu={(event) => p.onRowMenu(event, row.id)}
                  >
                    <RowIcon row={row} size={12} />
                    {editing ? (
                      <RowTitleInput row={row} onDone={() => setEditingRowId(null)} />
                    ) : (
                      <span className={title ? 'db-text' : 'db-text is-muted'}>{title || 'Untitled'}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
