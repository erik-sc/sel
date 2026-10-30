// A task that gets a project leaves the Inbox, and the list lets it fade first. Pure: no React, no
// DOM, no store. The list passes what it showed before and what it shows now; what is still to be
// seen going comes back in its old place.
import type { TaskGroup, TaskItem } from './lists'

/** How long a row fades out of the list (row.css `task-leave`, from the `--duration` token). */
export const LEAVE_MS = 300

/**
 * The tasks that were in the list and are not now, though they still exist, open, with a project:
 * the project was set. A task that was completed, deleted or renamed away is not one of them.
 */
export function leftWithProject(before: readonly TaskGroup[], now: readonly TaskGroup[], all: readonly TaskItem[]): TaskItem[] {
  const shown = new Set(now.flatMap((group) => group.items.map((task) => task.id)))
  const byId = new Map(all.map((task) => [task.id, task]))
  const left: TaskItem[] = []
  for (const group of before) {
    for (const task of group.items) {
      const still = byId.get(task.id)
      if (!shown.has(task.id) && still && !still.done && still.project) left.push(still)
    }
  }
  return left
}

/**
 * `now` with the fading tasks put back where `before` had them (clamped to the group's length).
 * They are the tasks as they are now (with their project), so the chip says where they went.
 */
export function withFading(before: readonly TaskGroup[], now: readonly TaskGroup[], fading: ReadonlyMap<string, TaskItem>): TaskGroup[] {
  if (fading.size === 0) return now as TaskGroup[]
  const put = now.map((group) => {
    const old = before.find((each) => each.id === group.id)
    if (!old) return group
    const present = new Set(group.items.map((task) => task.id))
    const items = [...group.items]
    old.items.forEach((task, index) => {
      const held = fading.get(task.id)
      if (held && !present.has(task.id)) items.splice(Math.min(index, items.length), 0, held)
    })
    return items.length === group.items.length ? group : { ...group, items }
  })
  return put.every((group, index) => group === now[index]) ? (now as TaskGroup[]) : put
}
