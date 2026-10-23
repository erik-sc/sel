// The weekly review's data (0.8.0 E1), one builder per step: what got done, what slid, which
// tasks may be the week's focus, and the digest the closing step (and later the persona) reads.
// Pure: tasks, pages and days in, lists out; no React, no store, no window.api.
import type { ActivitySummary } from '@shared/activity'
import { NOTEBOOK_ID } from '@shared/notebook'
import { SKY_ID } from '@shared/sky'
import { TASKS_DATABASE_ID } from '@shared/tasks'
import { inWeek, type WeekSpan } from '@shared/tasks/week'
import { titleOf } from '@shared/database/values'
import type { Block, SelectOption } from '@shared/types'
import type { TaskItem } from '@/tasks/lists'

/** The steps, in order. Each can be skipped; none has to be finished. */
export const REVIEW_STEPS = ['done', 'left', 'inbox', 'projects', 'next', 'close'] as const
export type ReviewStep = (typeof REVIEW_STEPS)[number]

/** A task as the review reads it (the Tasks screen's TaskItem, or a part of it). */
export type ReviewTask = Pick<
  TaskItem,
  'id' | 'title' | 'done' | 'due' | 'priority' | 'project' | 'completedAt' | 'recurring' | 'parent' | 'order' | 'createdAt'
>

// ---- 1. Done ------------------------------------------------------------------

export interface DoneGroup {
  /** null: tasks with no project (the Inbox). */
  project: Pick<SelectOption, 'id' | 'name' | 'color'> | null
  tasks: { id: string; title: string; at: string }[]
}

/**
 * The tasks completed in `week`, by project: projects in the order they come in the tasks, the
 * Inbox last, each project's tasks in the order they were completed. A repeating task counts by
 * its last completion (it is open again, with its next date).
 */
export function doneThisWeek(tasks: readonly ReviewTask[], week: WeekSpan): DoneGroup[] {
  const groups = new Map<string | null, DoneGroup>()
  const done = tasks
    .filter((task) => (task.done || task.recurring) && inWeek(task.completedAt, week))
    .sort((a, b) =>
      (a.completedAt ?? '') < (b.completedAt ?? '') ? -1 : (a.completedAt ?? '') > (b.completedAt ?? '') ? 1 : a.order - b.order
    )
  for (const task of done) {
    const key = task.project?.id ?? null
    let group = groups.get(key)
    if (!group) {
      group = { project: task.project ? { id: task.project.id, name: task.project.name, color: task.project.color } : null, tasks: [] }
      groups.set(key, group)
    }
    group.tasks.push({ id: task.id, title: task.title, at: task.completedAt ?? '' })
  }
  const inbox = groups.get(null)
  groups.delete(null)
  return inbox ? [...groups.values(), inbox] : [...groups.values()]
}

/** The first and the last millisecond of a week, in the computer's time zone. */
export function weekBounds(week: WeekSpan): { from: number; to: number } {
  const [y, m, d] = week.start.split('-').map(Number)
  return { from: new Date(y, m - 1, d).getTime(), to: new Date(y, m - 1, d + 7).getTime() - 1 }
}

export interface EditedPage {
  id: string
  title: string
}

/**
 * The pages edited in the week, the most recent first, from pages as `pages.listRecent` gives
 * them. A page's time is that of its last edit (an edit inside it touches it). Rows of the Tasks
 * database are tasks (step 1 has them), and Meditations and the Sky are not pages one edits.
 */
export function editedThisWeek(pages: readonly Block[], bounds: { from: number; to: number }): EditedPage[] {
  const seen = new Set<string>()
  return [...pages]
    .filter((page) => {
      if (!page || page.type !== 'page' || page.trashedAt || seen.has(page.id)) return false
      seen.add(page.id)
      if (page.parentId === TASKS_DATABASE_ID) return false
      if (page.id === NOTEBOOK_ID || page.parentId === NOTEBOOK_ID || page.id === SKY_ID || page.parentId === SKY_ID) return false
      return page.updatedAt >= bounds.from && page.updatedAt <= bounds.to
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((page) => ({ id: page.id, title: titleOf(page) }))
}

// ---- 2. What slid ---------------------------------------------------------------

/**
 * The open tasks that were due in the week up to today and are still open: what slid. Today
 * counts (the review is held at the end of the day); days of the week still to come do not. The
 * earliest first.
 */
export function slidThisWeek<T extends ReviewTask>(tasks: readonly T[], week: WeekSpan, today: string): T[] {
  const last = today < week.end ? today : week.end
  return tasks
    .filter((task) => !task.done && !!task.due && inWeek(task.due, { start: week.start, end: last }))
    .sort((a, b) => ((a.due ?? '') < (b.due ?? '') ? -1 : (a.due ?? '') > (b.due ?? '') ? 1 : a.order - b.order))
}

// ---- 5. The week to come ------------------------------------------------------------

/**
 * The tasks offered as the week's focus, best first: those already chosen (in their order), the
 * projects' next actions, what is due by the end of the week to come, then by priority (none
 * last) and the manual order. Open top-level tasks only; `query` narrows by name.
 */
export function focusCandidates<T extends ReviewTask>(
  tasks: readonly T[],
  next: WeekSpan,
  options: { chosen?: readonly string[]; nextActions?: ReadonlySet<string>; query?: string } = {}
): T[] {
  const chosen = options.chosen ?? []
  const nextActions = options.nextActions ?? new Set<string>()
  const query = (options.query ?? '').trim().toLocaleLowerCase()
  const rank = (task: T): number => {
    const at = chosen.indexOf(task.id)
    if (at >= 0) return at
    if (nextActions.has(task.id)) return 10
    if (task.due && task.due.slice(0, 10) <= next.end) return 20
    return 30
  }
  return tasks
    .filter((task) => !task.done && !task.parent && (!query || task.title.toLocaleLowerCase().includes(query) || chosen.includes(task.id)))
    .map((task) => ({ task, rank: rank(task) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.task.due ?? '9999').localeCompare(b.task.due ?? '9999') ||
        (a.task.priority ?? 4) - (b.task.priority ?? 4) ||
        a.task.order - b.task.order
    )
    .map((item) => item.task)
}

/** The chosen ids that are still open tasks, in their order. */
export function liveFocus(chosen: readonly string[], tasks: readonly ReviewTask[]): string[] {
  const open = new Set(tasks.filter((task) => !task.done).map((task) => task.id))
  return chosen.filter((id) => open.has(id))
}

// ---- 6. The close, and what the persona may read later ----------------------------------

/** The week in a few facts: the closing step's lines, and what a summary (C wave) would be handed. */
export interface WeekDigest {
  past: WeekSpan
  next: WeekSpan
  /** Titles of the tasks done. */
  done: string[]
  edited: number
  /** What still slid when the review closed (as slidThisWeek reads the tasks then). */
  left: number
  /** Inbox tasks still to refine. */
  inbox: number
  /** Projects still without a next action. */
  withoutNext: number
  /** Titles of the week's focus. */
  focus: string[]
  note: string
}

export function weekDigest(input: {
  past: WeekSpan
  next: WeekSpan
  done: readonly DoneGroup[]
  edited: readonly EditedPage[]
  slid: readonly ReviewTask[]
  inbox: number
  withoutNext: number
  focus: readonly string[]
  tasks: readonly ReviewTask[]
  note: string
}): WeekDigest {
  const byId = new Map(input.tasks.map((task) => [task.id, task]))
  return {
    past: input.past,
    next: input.next,
    done: input.done.flatMap((group) => group.tasks.map((task) => task.title)),
    edited: input.edited.length,
    left: input.slid.length,
    inbox: input.inbox,
    withoutNext: input.withoutNext,
    focus: input.focus.map((id) => byId.get(id)?.title ?? '').filter(Boolean),
    note: input.note.trim()
  }
}

/** What the activity log (D1) adds to step 1: days with something, focus sessions finished. Null when it holds nothing. */
export function activityNote(summary: ActivitySummary | null | undefined): { days: number; focus: number } | null {
  if (!summary || !summary.total) return null
  return { days: summary.byDay.filter((day) => day.count > 0).length, focus: summary.byKind['focus.finish'] ?? 0 }
}
