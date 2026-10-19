import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { PropertySchema } from '@shared/types'
import { ChevronLeft, ChevronRight, Plus } from '@/ui/icons'
import * as L from '../logic'
import * as actions from '../actions'
import { RowIcon, RowTitleInput, beginDrag, draggedOf, endDrag, rowTitle, weekdayLabels, type ViewProps } from '../common'

export function CalendarView(p: ViewProps): JSX.Element {
  const { databaseId, schema, view, rows, editingRowId, setEditingRowId } = p
  const dateProp: PropertySchema | undefined = L.groupProperty(view, schema)
  const [cursor, setCursor] = useState(() => L.monthOf(L.todayISO()))
  const [dropDay, setDropDay] = useState<string | null>(null)
  const weeks = useMemo(() => L.calendarMatrix(cursor.year, cursor.month), [cursor])
  const byDay = useMemo(() => L.rowsByDay(rows, dateProp), [rows, dateProp])
  const undated = useMemo(() => (dateProp ? rows.filter((row) => !L.dayKey(L.getCellValue(row, dateProp))).length : 0), [rows, dateProp])
  const today = L.todayISO()

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

  const shift = (delta: number): void => setCursor((current) => L.shiftMonth(current, delta))

  const dropOn = (day: string): void => {
    const dragged = draggedOf('event', databaseId)
    setDropDay(null)
    if (!dragged) return
    endDrag()
    // Day strings only, computed from the value in the store at drop time.
    actions.updateCell(dragged.id, dateProp, (current) => (L.isDateValue(current) ? L.shiftDateValue(current, day) : { start: day }))
  }

  return (
    <div className="db-calendar">
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
      <div className="db-calendar-grid is-weekdays">
        {weekdayLabels().map((label, index) => (
          <div key={index} className="db-calendar-weekday">
            {label}
          </div>
        ))}
      </div>
      <div className="db-calendar-grid">
        {weeks.flat().map((day) => {
          const classes = ['db-calendar-day']
          if (!day.inMonth) classes.push('is-outside')
          if (day.date === today) classes.push('is-today')
          if (dropDay === day.date) classes.push('is-drop-target')
          const items = byDay.get(day.date) ?? []
          return (
            <div
              key={day.date}
              className={classes.join(' ')}
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
              <div className="db-calendar-day-head">
                <span className="db-calendar-add" aria-hidden="true">
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
