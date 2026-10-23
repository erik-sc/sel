// The weekly review on Today: the week's focus while there is one (the tasks the last review
// chose for this week, struck through once done), and, Friday to Sunday, one quiet link to the
// review. Nothing at all otherwise; never a count, never a nudge beyond the link.
import type { JSX } from 'react'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { focusFor, isReviewTime } from '@shared/tasks/week'
import * as L from '@/database/logic'
import { useHome } from '@/home/store'
import { useBlock, useBlocks } from '@/store/blocks'
import { REVIEW_COPY } from './copy'
import { openWeekReview } from './route'

export function TodayWeek({ today, onOpenTask }: { today: string; onOpenTask?: (id: string) => void }): JSX.Element | null {
  const copy = REVIEW_COPY[useHome((state) => state.locale)]
  const database = useBlock(TASKS_DATABASE_ID)
  const week = focusFor(database?.props.week, today)
  const rows = useBlocks(week?.focus ?? [])
  const focus = rows.filter((row) => !!row && !row.trashedAt && row.parentId === TASKS_DATABASE_ID)
  const time = isReviewTime(today)
  if (!focus.length && !time) return null
  return (
    <div className="today-week">
      {focus.length > 0 && (
        <p className="today-week-focus">
          <span className="today-week-label">{copy.todayFocus}</span>
          {focus.map((row) => {
            if (!row) return null
            const values = L.isPlainObject(row.props.values) ? row.props.values : {}
            const done = values[TASK_PROPS.done] === true
            const title = L.titleOf(row) || '…'
            return (
              <span key={row.id} className={done ? 'today-week-item is-done' : 'today-week-item'}>
                {onOpenTask ? (
                  <button type="button" className="today-link is-inline" onClick={() => onOpenTask(row.id)}>
                    {title}
                  </button>
                ) : (
                  title
                )}
              </span>
            )
          })}
        </p>
      )}
      {time && (
        <p className="today-refine">
          <span>{copy.todayLine}</span>
          <span aria-hidden="true"> · </span>
          <button type="button" className="today-link is-inline" onClick={openWeekReview}>
            {copy.todayLink}
          </button>
        </p>
      )}
    </div>
  )
}
