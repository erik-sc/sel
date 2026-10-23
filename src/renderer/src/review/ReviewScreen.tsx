// The weekly review screen (0.8.0 E1): reads what the review shows and hands it to WeekReview.tsx.
// The tasks and the projects come from the built-in Tasks database as the Tasks screen reads it
// (kept current while the screen is open), the pages edited from `pages.listRecent`, and one
// quiet line from the local activity log (D1, aggregates only). Loaded on demand through Host.tsx.
import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { projectOverview } from '@shared/tasks/projects'
import { reviewWeeks } from '@shared/tasks/week'
import * as L from '@/database/logic'
import { openToday } from '@/briefing/route'
import { screenOf } from '@/screens'
import { openPage, openScreen } from '@/store/tabs'
import { useTasksDatabase } from '@/tasks/data'
import { openTasks, showTaskList } from '@/tasks/gate'
import { readTasks } from '@/tasks/lists'
import { activityNote, editedThisWeek, type EditedPage, weekBounds } from './steps'
import { WeekReview } from './WeekReview'

/** Recent pages read for the pages edited in the week (the most `pages.listRecent` gives). */
const RECENT_PAGES = 200

/**
 * The route the flows screen (D2–D4) is expected to take. TODO(0.8.0 D2): once feat/0.8.0-flows
 * lands, import its route from @/routes instead; until then the link shows only if a screen
 * with this route exists.
 */
const FLOWS_ROUTE = '_flows'

export function ReviewScreen(): JSX.Element {
  const { resolved, schema, rows } = useTasksDatabase()
  const [today] = useState(() => L.todayISO())
  const weeks = useMemo(() => reviewWeeks(today), [today])
  const tasks = useMemo(() => readTasks(rows, schema), [rows, schema])
  const database = resolved?.view
  const projects = useMemo(() => projectOverview(database, rows), [database, rows])
  const [edited, setEdited] = useState<EditedPage[] | null>(null)
  const [activity, setActivity] = useState<{ days: number; focus: number } | null>(null)

  useEffect(() => {
    let live = true
    const bounds = weekBounds(weeks.past)
    window.api.pages.listRecent(RECENT_PAGES).then(
      (pages) => live && setEdited(editedThisWeek(pages ?? [], bounds)),
      (error: unknown) => {
        console.error('the pages of the week could not be read', error)
        if (live) setEdited([])
      }
    )
    window.api.activity.summary({ from: bounds.from, to: bounds.to + 1 }).then(
      (summary) => live && setActivity(activityNote(summary)),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [weeks.past])

  const flows = screenOf(FLOWS_ROUTE) ? () => openScreen(FLOWS_ROUTE) : null

  return (
    <WeekReview
      today={today}
      tasks={tasks}
      projects={projects}
      edited={edited}
      activity={activity}
      storedWeek={database?.props.week}
      onOpenPage={openPage}
      onOpenProject={(id) => {
        openTasks()
        showTaskList({ kind: 'project', id })
      }}
      onOpenToday={openToday}
      onOpenFlows={flows}
    />
  )
}
