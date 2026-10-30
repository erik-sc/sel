// Ticking tasks from a list (Today, the calendar's day). Pure of the screens: a hook over the
// settle timers, the briefing calls and the toast.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localDay, type BriefingTask } from '@shared/briefing'
import { useHome } from '@/home/store'
import { TASK_COPY } from '@/tasks/copy'
import { dueLabel } from '@/tasks/lists'
import { dismissToast, notifyError, toast } from '@/ui/toast'
import { BRIEFING_COPY } from './copy'
import { tickedKey } from './format'
import { createSettler, foldDuration, type Phase, type Settler } from './settle'

/** Whether the person asked for less motion (the fold then takes no time). */
function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface Completing {
  /** The `tickedKey` of the tasks that are gone from the list. */
  done: ReadonlySet<string>
  /** The tasks ticked and still in place (`done`) or folding away, by `tickedKey`. Only with `calm`. */
  settling: ReadonlyMap<string, Exclude<Phase, 'gone'>>
  complete: (task: BriefingTask) => void
  /** Takes back a task ticked a moment ago, from its own checkbox. */
  reopen: (task: BriefingTask) => void
}

/**
 * Marking tasks done from a list. `done` holds the `tickedKey` of those that left it; the next
 * load no longer has them, or has a repeating one on its next date. A toast names the task and
 * offers to take it back.
 *
 * With `calm` (Today) a ticked task does not leave at the click: it shows as done (`settling`),
 * and folds away `READ_MS` later, so what was done can be seen. Taking it back before then
 * cancels the fold. Without it (the calendar) it leaves at once.
 */
export function useCompleteTask(options: { calm?: boolean } = {}): Completing {
  const calm = options.calm === true
  const [phases, setPhases] = useState<ReadonlyMap<string, Phase>>(() => new Map())
  const locale = useHome((state) => state.locale)
  const localeRef = useRef(locale)
  localeRef.current = locale
  /** The call that completed each task, and the toast that offers to undo it. */
  const pending = useRef(new Map<string, { call: Promise<{ token: string }>; toastId?: string }>())

  const setPhase = useCallback((key: string, phase: Phase | null): void => {
    setPhases((current) => {
      if ((current.get(key) ?? null) === phase) return current
      const next = new Map(current)
      if (phase) next.set(key, phase)
      else next.delete(key)
      return next
    })
  }, [])

  const settler = useRef<Settler | null>(null)
  if (!settler.current) settler.current = createSettler(setPhase, () => foldDuration(reducedMotion()))
  useEffect(() => {
    const own = settler.current
    return () => own?.dispose()
  }, [])

  const complete = useCallback(
    (task: BriefingTask): void => {
      const key = tickedKey(task)
      const words = BRIEFING_COPY[localeRef.current]
      const restore = (): void => {
        settler.current?.cancel(key)
        setPhase(key, null)
        pending.current.delete(key)
      }
      if (calm) {
        setPhase(key, 'done')
        settler.current?.start(key)
      } else setPhase(key, 'gone')
      const call = window.api.briefing.completeTask(task.id)
      pending.current.set(key, { call })
      call.then(
        ({ token, next }) => {
          const entry = pending.current.get(key)
          const when = next ? dueLabel(next.slice(0, 10), localDay(), undefined, TASK_COPY[localeRef.current].days).text : undefined
          // A repeating task stays open with a later date: it is off today's list all the same.
          const id = toast(words.done(task.title, when), {
            action: {
              label: words.undo,
              run: () => {
                // Within the wait the row stays whole; if taking it back fails, the wait starts over.
                settler.current?.cancel(key)
                window.api.briefing.undoCompleteTask(token).then(restore, (error: unknown) => {
                  if (calm && entry) settler.current?.start(key)
                  notifyError(words.undoFailed, error)
                })
              }
            }
          })
          if (entry) entry.toastId = id
        },
        (error: unknown) => {
          restore()
          notifyError(words.doneFailed, error)
        }
      )
    },
    [calm, setPhase]
  )

  const reopen = useCallback(
    (task: BriefingTask): void => {
      const key = tickedKey(task)
      const entry = pending.current.get(key)
      const words = BRIEFING_COPY[localeRef.current]
      if (!entry) return
      settler.current?.cancel(key)
      entry.call
        .then(
          ({ token }) => {
            if (entry.toastId) dismissToast(entry.toastId)
            return window.api.briefing.undoCompleteTask(token).then(() => {
              pending.current.delete(key)
              setPhase(key, null)
            })
          },
          () => undefined
        )
        .catch((error: unknown) => {
          if (calm) settler.current?.start(key)
          notifyError(words.undoFailed, error)
        })
    },
    [calm, setPhase]
  )

  const done = useMemo(() => new Set([...phases].filter(([, phase]) => phase === 'gone').map(([key]) => key)), [phases])
  const settling = useMemo(() => {
    const out = new Map<string, Exclude<Phase, 'gone'>>()
    for (const [key, phase] of phases) if (phase !== 'gone') out.set(key, phase)
    return out
  }, [phases])
  return { done, settling, complete, reopen }
}
