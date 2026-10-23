// The weekly review (0.8.0 E1), drawn from what ReviewScreen.tsx reads: six quiet steps, each one
// skippable, the step marks above them to jump with the mouse or the keyboard. Done (what got
// done and the pages worked on), Slid (what was due and is still open: next week, a date, no
// date, or the trash), the Inbox (the refine walk of the Tasks screen, Refine.tsx), Projects (a
// next action for those without one, a new date for late milestones), the week to come (up to
// three tasks and a note, kept as the week's focus, shared/tasks/week.ts), and the close. The
// review proposes; every change is one the user makes here. No score, no streak.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { lateMilestones, type ProjectSummary } from '@shared/tasks/projects'
import { movedTo, reviewWeeks, toggleFocus, WEEK_FOCUS_MAX, WEEK_NOTE_MAX, weekFocus } from '@shared/tasks/week'
import { useHome } from '@/home/store'
import { Button } from '@/ui/Button'
import type { PopoverAnchor } from '@/ui/Popover'
import { TASK_COPY } from '@/tasks/copy'
import { deleteTask, setDue } from '@/tasks/edit'
import { TaskFieldPopover } from '@/tasks/lazy'
import { dueLabel, type TaskItem } from '@/tasks/lists'
import { setNextAction, updateMilestone } from '@/tasks/projects'
import { Refine } from '@/tasks/Refine'
import { refineQueue } from '@/tasks/refineWalk'
import { REVIEW_COPY } from './copy'
import { saveWeekFocus } from './edit'
import { useWeekSummarizer } from './route'
import { doneThisWeek, type EditedPage, focusCandidates, liveFocus, REVIEW_STEPS, type ReviewStep, slidThisWeek, weekDigest } from './steps'
import './review.css'

/** Pages listed in the first step before "and N more". */
const PAGES_SHOWN = 12
/** Tasks offered as the week's focus while nothing is searched. */
const CANDIDATES_SHOWN = 12

export interface WeekReviewProps {
  today: string
  /** The tasks as the Tasks screen reads them, kept current. */
  tasks: readonly TaskItem[]
  projects: readonly ProjectSummary[]
  /** The pages edited in the week; null while they are read. */
  edited: readonly EditedPage[] | null
  /** What the activity log adds, when it holds anything. */
  activity: { days: number; focus: number } | null
  /** The Tasks database's `props.week` as stored. */
  storedWeek: unknown
  onOpenPage: (id: string) => void
  onOpenProject: (id: string) => void
  onOpenToday: () => void
  /** Opens the flows screen (D2–D4), when there is one. */
  onOpenFlows?: (() => void) | null
}

export function WeekReview({
  today,
  tasks,
  projects,
  edited,
  activity,
  storedWeek,
  onOpenPage,
  onOpenProject,
  onOpenToday,
  onOpenFlows
}: WeekReviewProps): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = REVIEW_COPY[locale]
  const taskWords = TASK_COPY[locale]
  const summarize = useWeekSummarizer((state) => state.summarize)
  // The weeks are those of the day the review was opened, even past midnight.
  const [weeks] = useState(() => reviewWeeks(today))
  const [step, setStep] = useState(0)
  const [phase, setPhase] = useState<'steps' | 'closed'>('steps')
  const [refining, setRefining] = useState(false)
  // Tasks and projects acted on stay listed (as taken care of) until the review is left.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [touchedProjects, setTouchedProjects] = useState<ReadonlySet<string>>(() => new Set())
  const [editing, setEditing] = useState<{ id: string; anchor: PopoverAnchor } | null>(null)
  const stored = useMemo(() => weekFocus(storedWeek, weeks.next.start), [storedWeek, weeks.next.start])
  const [chosen, setChosen] = useState<string[]>(() => stored?.focus ?? [])
  const [note, setNote] = useState(() => stored?.note ?? '')
  const [query, setQuery] = useState('')
  const seeded = useRef(stored !== null)
  const heading = useRef<HTMLHeadingElement>(null)
  const closedRef = useRef<HTMLParagraphElement>(null)
  const mounted = useRef(false)
  const titleId = useId()

  // The stored focus may arrive after the screen: taken once, before anything is chosen here.
  useEffect(() => {
    if (seeded.current || !stored) return
    seeded.current = true
    setChosen(stored.focus)
    setNote(stored.note)
  }, [stored])

  // Each step's title takes the focus (not on arrival), so the keyboard and a screen reader follow.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (phase === 'closed') closedRef.current?.focus()
    else if (!refining) heading.current?.focus()
  }, [step, phase, refining])

  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const done = useMemo(() => doneThisWeek(tasks, weeks.past), [tasks, weeks.past])
  const slid = useMemo(() => slidThisWeek(tasks, weeks.past, today), [tasks, weeks.past, today])
  const slidIds = useMemo(() => new Set(slid.map((task) => task.id)), [slid])
  // A row keeps the place it first had (the earliest due first), also once it is taken care of.
  const leftOrder = useRef<string[]>([])
  const leftRows = useMemo(() => {
    for (const task of slid) if (!leftOrder.current.includes(task.id)) leftOrder.current.push(task.id)
    return leftOrder.current
      .filter((id) => slidIds.has(id) || touched.has(id))
      .map((id) => byId.get(id))
      .filter((task): task is TaskItem => !!task)
  }, [slid, slidIds, touched, byId])
  const inbox = useMemo(() => refineQueue(tasks, 'inbox').length, [tasks])
  const projectRows = useMemo(
    () => projects.filter((project) => project.needsNext || lateMilestones(project, today).length > 0 || touchedProjects.has(project.id)),
    [projects, today, touchedProjects]
  )
  const nextActions = useMemo(() => new Set(projects.map((project) => project.next?.id).filter((id): id is string => !!id)), [projects])
  const focus = useMemo(() => liveFocus(chosen, tasks), [chosen, tasks])
  const candidates = useMemo(
    () => focusCandidates(tasks, weeks.next, { chosen: focus, nextActions, query }),
    [tasks, weeks.next, focus, nextActions, query]
  )

  const name: ReviewStep = REVIEW_STEPS[step]
  const range = copy.range(weeks.past)
  const nextRange = copy.range(weeks.next)

  const touch = (id: string): void => setTouched((current) => new Set(current).add(id))
  const touchProject = (id: string): void => setTouchedProjects((current) => new Set(current).add(id))
  const keepNote = (): void => {
    if (note.trim() !== (stored?.note ?? '')) saveWeekFocus(weeks.next.start, focus, note, today)
  }
  const go = (index: number): void => {
    if (name === 'next') keepNote()
    setRefining(false)
    setStep(Math.max(0, Math.min(REVIEW_STEPS.length - 1, index)))
  }
  const choose = (id: string): void => {
    const next = toggleFocus(focus, id)
    if (next.length === focus.length && !focus.includes(id)) return
    setChosen(next)
    saveWeekFocus(weeks.next.start, next, note, today)
  }
  const digest = (): ReturnType<typeof weekDigest> =>
    weekDigest({
      past: weeks.past,
      next: weeks.next,
      done,
      edited: edited ?? [],
      slid,
      inbox,
      withoutNext: projects.filter((project) => project.needsNext).length,
      focus,
      tasks,
      note
    })

  if (phase === 'closed') {
    return (
      <article className="review" aria-labelledby={titleId}>
        <header className="review-head">
          <p className="review-kicker">{copy.title}</p>
          <h1 className="review-range" id={titleId}>
            {range}
          </h1>
        </header>
        <section className="review-closed" aria-live="polite">
          <p className="review-closed-words" ref={closedRef} tabIndex={-1}>
            {copy.closed}
          </p>
          <p className="review-quiet">{copy.closedHelp}</p>
          <button type="button" className="review-link" onClick={onOpenToday}>
            {copy.openToday}
          </button>
        </section>
      </article>
    )
  }

  const shownPages = edited?.slice(0, PAGES_SHOWN) ?? []
  const shownCandidates = query.trim() ? candidates : candidates.slice(0, Math.max(CANDIDATES_SHOWN, focus.length))
  const full = focus.length >= WEEK_FOCUS_MAX

  return (
    <article className="review" lang={locale} aria-labelledby={titleId}>
      <header className="review-head">
        <p className="review-kicker">{copy.title}</p>
        <h1 className="review-range" id={titleId}>
          {range}
        </h1>
      </header>

      <nav aria-label={copy.stepOf(step + 1, REVIEW_STEPS.length)}>
        <ol className="review-steps">
          {REVIEW_STEPS.map((each, index) => (
            <li key={each} className={index === step ? 'review-step is-current' : index < step ? 'review-step is-past' : 'review-step'}>
              <button
                type="button"
                className="review-step-button"
                aria-current={index === step ? 'step' : undefined}
                aria-label={`${copy.stepOf(index + 1, REVIEW_STEPS.length)}: ${copy.steps[each]}`}
                onClick={() => go(index)}
              >
                <span className="review-step-mark" aria-hidden="true" />
                <span className="review-step-name">{copy.steps[each]}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section key={name} className="review-body" aria-labelledby="review-step-title">
        <h2 className="review-title" id="review-step-title" ref={heading} tabIndex={-1}>
          {copy.heads[name]}
        </h2>

        {name === 'done' && (
          <>
            <p className="review-help">{copy.doneHelp}</p>
            {activity && (
              <p className="review-activity">
                <span>{copy.activity(activity.days, activity.focus)}</span>
                {/* TODO(0.8.0 D2): the flows screen; ReviewScreen passes its opener once the route exists. */}
                {onOpenFlows && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <button type="button" className="review-link is-inline" onClick={onOpenFlows}>
                      {copy.flows}
                    </button>
                  </>
                )}
              </p>
            )}
            {done.length ? (
              <div className="review-groups">
                {done.map((group) => (
                  <div key={group.project?.id ?? 'inbox'} className="review-group">
                    <h3 className="review-label">
                      {group.project?.name ?? copy.noProject} <span className="review-count">{group.tasks.length}</span>
                    </h3>
                    <ul className="review-list">
                      {group.tasks.map((task) => (
                        <li key={task.id}>{task.title || taskWords.untitled}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="review-quiet">{copy.doneEmpty}</p>
            )}
            {edited !== null && (
              <div className="review-group">
                <h3 className="review-label">{edited.length ? copy.edited(edited.length) : copy.editedNone}</h3>
                {shownPages.length > 0 && (
                  <ul className="review-list is-pages">
                    {shownPages.map((page) => (
                      <li key={page.id}>
                        <button type="button" className="review-page" onClick={() => onOpenPage(page.id)}>
                          {page.title || taskWords.untitled}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {edited.length > PAGES_SHOWN && <p className="review-quiet">{copy.editedMore(edited.length - PAGES_SHOWN)}</p>}
              </div>
            )}
          </>
        )}

        {name === 'left' && (
          <>
            <p className="review-help">{copy.leftHelp}</p>
            {leftRows.length ? (
              <ul className="review-tasks">
                {leftRows.map((task) => {
                  const handled = !slidIds.has(task.id)
                  const title = task.title || taskWords.untitled
                  return (
                    <li key={task.id} className={handled ? 'review-task is-handled' : 'review-task'}>
                      <div className="review-task-text">
                        <span className="review-task-title">{title}</span>
                        <span className="review-task-meta">
                          {handled
                            ? [copy.leftHandled, task.due ? dueLabel(task.due, today, undefined, taskWords.days).text : copy.dropDate].join(
                                ' · '
                              )
                            : copy.due(dueLabel(task.due ?? today, today, undefined, taskWords.days).text)}
                        </span>
                      </div>
                      <div className="review-task-actions" role="group" aria-label={copy.taskActions(title)}>
                        <button
                          type="button"
                          className="review-chip"
                          onClick={() => {
                            touch(task.id)
                            setDue(task.id, { start: movedTo(task.due, weeks.next.start) })
                          }}
                        >
                          {copy.nextWeek}
                        </button>
                        <button
                          type="button"
                          className="review-chip"
                          onClick={(event) => {
                            touch(task.id)
                            setEditing({ id: task.id, anchor: event.currentTarget })
                          }}
                        >
                          {copy.pickDate}
                        </button>
                        <button
                          type="button"
                          className="review-chip"
                          disabled={!task.due}
                          onClick={() => {
                            touch(task.id)
                            setDue(task.id, null)
                          }}
                        >
                          {copy.dropDate}
                        </button>
                        <button type="button" className="review-chip is-quiet" onClick={() => deleteTask(task.id)}>
                          {copy.remove}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="review-quiet">{copy.leftEmpty}</p>
            )}
          </>
        )}

        {name === 'inbox' &&
          (refining ? (
            <div className="review-refine">
              <Refine tasks={tasks} from="inbox" today={today} onExit={() => setRefining(false)} />
            </div>
          ) : (
            <>
              <p className="review-help">{copy.inboxHelp}</p>
              {inbox ? (
                <p className="review-inbox">
                  <span>{copy.inboxCount(inbox)}</span>
                  <Button variant="primary" onClick={() => setRefining(true)}>
                    {copy.inboxStart}
                  </Button>
                </p>
              ) : (
                <p className="review-quiet" role="status">
                  {copy.inboxEmpty}
                </p>
              )}
            </>
          ))}

        {name === 'projects' && (
          <>
            <p className="review-help">{copy.projectsHelp}</p>
            {projectRows.length ? (
              <ul className="review-projects">
                {projectRows.map((project) => {
                  const open = tasks.filter((task) => !task.done && task.project?.id === project.id)
                  const late = lateMilestones(project, today)
                  const selectId = `review-next-${project.id}`
                  return (
                    <li key={project.id} className="review-project">
                      <h3 className="review-project-name">{project.name}</h3>
                      {project.objective && <p className="review-quiet">{project.objective}</p>}
                      {(project.needsNext || touchedProjects.has(project.id)) &&
                        (open.length ? (
                          <div className="review-field">
                            <label htmlFor={selectId}>{copy.nextAction}</label>
                            <select
                              id={selectId}
                              className="review-select"
                              value={project.next?.id ?? ''}
                              onChange={(event) => {
                                touchProject(project.id)
                                setNextAction(project.id, event.target.value || null)
                              }}
                            >
                              <option value="">{copy.chooseNext}</option>
                              {[...open]
                                .sort((a, b) =>
                                  a.id === project.suggestion?.id ? -1 : b.id === project.suggestion?.id ? 1 : a.order - b.order
                                )
                                .map((task) => (
                                  <option key={task.id} value={task.id}>
                                    {task.title || taskWords.untitled}
                                  </option>
                                ))}
                            </select>
                          </div>
                        ) : (
                          <p className="review-quiet">
                            {copy.noOpenTasks}{' '}
                            <button type="button" className="review-link is-inline" onClick={() => onOpenProject(project.id)}>
                              {copy.openProject}
                            </button>
                          </p>
                        ))}
                      {late.length > 0 && (
                        <div className="review-milestones">
                          <h4 className="review-label">{copy.late}</h4>
                          <ul className="review-list">
                            {late.map((milestone) => (
                              <li key={milestone.id} className="review-milestone">
                                <span>{milestone.title}</span>
                                <input
                                  type="date"
                                  className="review-date"
                                  aria-label={copy.milestoneDate(milestone.title)}
                                  defaultValue={milestone.date ?? ''}
                                  onChange={(event) => {
                                    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) return
                                    touchProject(project.id)
                                    updateMilestone(project.id, milestone.id, { date: event.target.value })
                                  }}
                                />
                                <button
                                  type="button"
                                  className="review-chip"
                                  onClick={() => {
                                    touchProject(project.id)
                                    updateMilestone(project.id, milestone.id, { done: true })
                                  }}
                                >
                                  {copy.milestoneDone}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="review-quiet">{copy.projectsEmpty}</p>
            )}
          </>
        )}

        {name === 'next' && (
          <>
            <p className="review-help">{copy.nextHelp(nextRange)}</p>
            <div className="review-find">
              <input
                type="search"
                className="review-input"
                value={query}
                placeholder={copy.find}
                aria-label={copy.find}
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className="review-count" role="status">
                {copy.chosen(focus.length, WEEK_FOCUS_MAX)}
              </span>
            </div>
            {full && <p className="review-quiet">{copy.full}</p>}
            {shownCandidates.length ? (
              <ul className="review-candidates">
                {shownCandidates.map((task) => {
                  const checked = focus.includes(task.id)
                  const meta = [
                    task.project ? `#${task.project.name}` : '',
                    task.due ? dueLabel(task.due, today, undefined, taskWords.days).text : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <li key={task.id} className={checked ? 'review-candidate is-chosen' : 'review-candidate'}>
                      <label>
                        <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => choose(task.id)} />
                        <span className="review-task-title">{task.title || taskWords.untitled}</span>
                        {meta && <span className="review-task-meta">{meta}</span>}
                      </label>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="review-quiet">{copy.noCandidates}</p>
            )}
            <label className="review-note">
              <span className="review-label">{copy.note}</span>
              <textarea
                className="review-textarea"
                rows={3}
                value={note}
                maxLength={WEEK_NOTE_MAX}
                placeholder={copy.notePlaceholder}
                onChange={(event) => setNote(event.target.value)}
                onBlur={keepNote}
              />
            </label>
          </>
        )}

        {name === 'close' &&
          (() => {
            const week = digest()
            return (
              <>
                <p className="review-help">{copy.closeHelp}</p>
                <ul className="review-summary">
                  <li>{copy.doneCount(week.done.length)}</li>
                  {edited !== null && <li>{copy.editedCount(week.edited)}</li>}
                  {week.left > 0 && <li>{copy.leftCount(week.left)}</li>}
                  <li>{week.inbox ? copy.inboxLeft(week.inbox) : copy.inboxZero}</li>
                  {week.withoutNext > 0 && <li>{copy.withoutNext(week.withoutNext)}</li>}
                </ul>
                <div className="review-group">
                  <h3 className="review-label">{copy.focusFor(nextRange)}</h3>
                  {week.focus.length ? (
                    <ol className="review-list is-focus">
                      {week.focus.map((title, index) => (
                        <li key={`${index}-${title}`}>{title}</li>
                      ))}
                    </ol>
                  ) : (
                    <p className="review-quiet">{copy.noFocus}</p>
                  )}
                  {week.note && <blockquote className="review-echo">{week.note}</blockquote>}
                </div>
                {summarize && (
                  <button type="button" className="review-link" onClick={() => summarize(week)}>
                    {copy.summarize}
                  </button>
                )}
              </>
            )
          })()}

        {!refining && (
          <div className="review-actions">
            {step > 0 && (
              <Button variant="ghost" onClick={() => go(step - 1)}>
                {copy.back}
              </Button>
            )}
            {step < REVIEW_STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => go(step + 1)}>
                {copy.next}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setPhase('closed')}>
                {copy.finish}
              </Button>
            )}
          </div>
        )}
      </section>

      {editing && <TaskFieldPopover taskId={editing.id} field="date" anchor={editing.anchor} onClose={() => setEditing(null)} />}
    </article>
  )
}
