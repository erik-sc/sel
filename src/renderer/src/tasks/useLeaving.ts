// The Inbox keeps a task that just got a project on screen for the length of its fade (leaving.ts),
// then lets it go. Other lists, and "reduce motion", drop it at once: the fade is the only reason to wait.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TaskGroup, TaskItem } from './lists'
import { LEAVE_MS, leftWithProject, withFading } from './leaving'

interface Fading {
  before: readonly TaskGroup[]
  items: ReadonlyMap<string, TaskItem>
}

const NONE: Fading = { before: [], items: new Map() }

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** `groups` with the tasks that are fading out put back, and the ids of those. */
export function useLeaving(
  groups: readonly TaskGroup[],
  tasks: readonly TaskItem[],
  listId: string,
  fades: boolean
): { groups: TaskGroup[]; leaving: ReadonlySet<string> } {
  const [fading, setFading] = useState<Fading>(NONE)
  const shown = useRef<{ listId: string; groups: readonly TaskGroup[] }>({ listId, groups })
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  const displayed = useMemo(() => withFading(fading.before, groups, fading.items), [fading, groups])

  useLayoutEffect(() => {
    const previous = shown.current
    if (previous.listId !== listId) {
      setFading(NONE)
      return
    }
    if (!fades || reducedMotion()) return
    // Those already fading are in `previous` and not in `groups` too: they started their fade already.
    const left = leftWithProject(previous.groups, groups, tasks).filter((task) => !fading.items.has(task.id))
    if (!left.length) return
    setFading((now) => ({
      before: previous.groups,
      items: new Map([...now.items, ...left.map((task) => [task.id, task] as const)])
    }))
    const ids = left.map((task) => task.id)
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setFading((now) => {
        const items = new Map(now.items)
        for (const id of ids) items.delete(id)
        return { before: now.before, items }
      })
    }, LEAVE_MS)
    timers.current.add(timer)
  }, [groups, listId, tasks, fades, fading])

  // What is on screen now, for the next change to compare with.
  useLayoutEffect(() => {
    shown.current = { listId, groups: displayed }
  })

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
    },
    []
  )

  const leaving = useMemo(() => new Set(fading.items.keys()), [fading])
  return { groups: displayed, leaving }
}
