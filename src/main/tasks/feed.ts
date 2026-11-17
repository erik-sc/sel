// The tasks' calendar, as the remote server gives it to whoever has its address
// (shared/tasks/ics.ts): the open tasks with a date. What is kept private from the AI stays out
// of it too: it leaves this computer just the same.
import { timingSafeEqual } from 'node:crypto'
import { isPrivateForAi, privacyChecker } from '../../shared/aiPrivate'
import { TASK_PROPS, TASK_PRIORITIES, TASKS_DATABASE_ID } from '../../shared/tasks'
import { cleanTasksFeed, TASKS_FEED_KEY, tasksCalendar, type FeedTask } from '../../shared/tasks/ics'
import { readRecurrence } from '../../shared/tasks/recur'
import type { Block, PropertySchema, PropertyValue } from '../../shared/types'
import type { Repository } from '../db/repository'

/** A calendar is not asked for more than this many tasks. */
const MAX_TASKS = 2000

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function feedTasks(repo: Repository): FeedTask[] {
  const database = repo.get(TASKS_DATABASE_ID)
  if (!database || database.type !== 'database' || database.trashedAt !== null || isPrivateForAi(repo, database.id)) return []
  const hidden = privacyChecker(repo)
  const schema = (database.props.schema ?? {}) as Record<string, PropertySchema>
  const names = (id: string): Map<string, string> => new Map((schema[id]?.options ?? []).map((option) => [option.id, option.name]))
  const projects = names(TASK_PROPS.project)
  const labels = names(TASK_PROPS.labels)
  const out: FeedTask[] = []
  for (const row of repo.children(database.id) as Block[]) {
    if (row.type !== 'page' || row.trashedAt !== null || hidden(row.id)) continue
    const values = (row.props.values ?? {}) as Record<string, PropertyValue>
    const own = (id: string): unknown => (Object.hasOwn(values, id) ? values[id] : undefined)
    if (own(TASK_PROPS.done) === true) continue
    const date = own(TASK_PROPS.due)
    const due = date && typeof date === 'object' && !Array.isArray(date) ? (date as { start?: unknown }).start : undefined
    if (typeof due !== 'string') continue
    const project = own(TASK_PROPS.project)
    const tagged = own(TASK_PROPS.labels)
    const priority = own(TASK_PROPS.priority)
    const recurrence = readRecurrence(own(TASK_PROPS.recurrence) as PropertyValue | undefined)
    out.push({
      id: row.id,
      title: (row.props.title ?? []).map((span) => span[0]).join(''),
      due,
      project: typeof project === 'string' ? (projects.get(project) ?? null) : null,
      priority: TASK_PRIORITIES.find((each) => each.id === priority)?.name ?? null,
      labels: Array.isArray(tagged)
        ? tagged.map((id) => (typeof id === 'string' ? labels.get(id) : undefined)).filter((n): n is string => !!n)
        : [],
      recurrence: recurrence ? { rule: recurrence.rule, from: recurrence.from } : null,
      updatedAt: row.updatedAt
    })
    if (out.length >= MAX_TASKS) break
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
}

/**
 * The calendar for the secret asked with, or null: when it is not published, or the secret is
 * not the one of now. Read at every request, so turning it off or changing the address is at once.
 */
export function tasksFeed(repo: Repository, token: string, now: Date): string | null {
  const feed = cleanTasksFeed(repo.getSetting(TASKS_FEED_KEY))
  if (!feed.enabled || !same(feed.token, token)) return null
  let timeZone: string | undefined
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    timeZone = undefined
  }
  return tasksCalendar(feedTasks(repo), { name: 'sel', now, timeZone })
}
