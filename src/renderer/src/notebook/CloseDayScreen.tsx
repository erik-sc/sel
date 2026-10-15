// Closing the day: one quiet screen in four steps. What happened (read-only, short), the one line
// worth keeping (today's line in the ink notebook), up to three things for tomorrow (kept on
// tomorrow's day of the notebook, so they sync), and the close itself: the window dims to "Until
// tomorrow" with a soft bell, and any key or click wakes it. No streaks, no scores, no counts.
// Loaded on demand through Host.tsx.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { localDay } from '@shared/briefing'
import { bellOn, nextDay, NOTEBOOK_BELL_KEY, NOTEBOOK_LIMITS, type DayReview, type DayReviewItem } from '@shared/notebook'
import { Button } from '@/ui/Button'
import { ringBell } from './bell'
import { CLOSE_COPY, dayHeading, type CloseCopy } from './copy'
import { openNotebook } from './route'
import './notebook.css'
import './close.css'

const STEPS = 4

type Problem = null | 'failed' | 'ended'

function ReviewList({ label, items }: { label: string; items: DayReviewItem[] }): JSX.Element | null {
  if (!items.length) return null
  return (
    <div className="close-review">
      <h3 className="close-review-label">{label}</h3>
      <ul className="close-review-list">
        {items.map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  )
}

/** The window at rest: dimmed, two words, until a key or a click. */
function Rest({ copy, onWake }: { copy: CloseCopy; onWake: () => void }): JSX.Element {
  const [waking, setWaking] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
    let woke = false
    // A moment's grace, so the click that closed the day does not wake it again at once.
    const armedAt = Date.now() + 600
    const wake = (event: Event): void => {
      if (woke || Date.now() < armedAt) return
      event.preventDefault()
      event.stopPropagation()
      woke = true
      setWaking(true)
      setTimeout(onWake, 450)
    }
    window.addEventListener('keydown', wake, true)
    window.addEventListener('pointerdown', wake, true)
    return () => {
      window.removeEventListener('keydown', wake, true)
      window.removeEventListener('pointerdown', wake, true)
    }
  }, [onWake])

  return createPortal(
    <div ref={ref} className={waking ? 'close-rest is-waking' : 'close-rest'} role="dialog" aria-modal="true" aria-label={copy.rest} tabIndex={-1}>
      <div className="close-rest-inner">
        <p className="close-rest-words">{copy.rest}</p>
        <p className="close-rest-hint">{copy.restHint}</p>
      </div>
    </div>,
    document.body
  )
}

export function CloseDayScreen(): JSX.Element {
  const [review, setReview] = useState<DayReview | null>(null)
  const [failed, setFailed] = useState(false)
  const [step, setStep] = useState(0)
  const [line, setLine] = useState('')
  const [plans, setPlans] = useState(['', '', ''])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>(null)
  const [phase, setPhase] = useState<'steps' | 'rest' | 'closed'>('steps')
  const heading = useRef<HTMLHeadingElement>(null)

  const load = useCallback((): void => {
    setFailed(false)
    window.api.notebook.review().then(
      (data) => {
        setReview(data)
        setLine(data.line)
        setPlans([0, 1, 2].map((i) => data.tomorrowPlans[i] ?? ''))
      },
      (error: unknown) => {
        console.error('the day could not be read', error)
        setFailed(true)
      }
    )
  }, [])

  useEffect(load, [load])

  // Each step's title takes the focus, so the screen reader and the keyboard follow the steps.
  useEffect(() => {
    if (review && phase === 'steps') heading.current?.focus()
  }, [step, review, phase])

  const wake = useCallback(() => setPhase('closed'), [])

  if (!review) {
    const copy = CLOSE_COPY.en
    return (
      <article className="close" aria-busy={!failed}>
        {failed && (
          <>
            <p className="notebook-quiet" role="alert">
              {copy.loadFailed}
            </p>
            <button type="button" className="notebook-link" onClick={load}>
              {copy.tryAgain}
            </button>
          </>
        )}
      </article>
    )
  }

  const copy = CLOSE_COPY[review.locale]
  const day = review.today

  /** Writes what the step holds before moving on: the line, then the plans. */
  const save = async (): Promise<boolean> => {
    if (localDay() !== day) {
      setProblem('ended')
      return false
    }
    setBusy(true)
    setProblem(null)
    try {
      if (step === 1 && line.trim() !== review.line) {
        const entry = await window.api.notebook.write(day, line)
        setReview({ ...review, line: entry.text })
      } else if (step === 2 && JSON.stringify(plans.map((p) => p.trim()).filter(Boolean)) !== JSON.stringify(review.tomorrowPlans)) {
        const entry = await window.api.notebook.plan(nextDay(day), plans)
        setReview({ ...review, tomorrowPlans: entry.plans })
      }
      return true
    } catch (error) {
      console.error('closing the day failed', error)
      setProblem(error instanceof Error && /has ended/.test(error.message) ? 'ended' : 'failed')
      return false
    } finally {
      setBusy(false)
    }
  }

  const next = async (): Promise<void> => {
    if (await save()) setStep((s) => Math.min(STEPS - 1, s + 1))
  }

  const close = async (): Promise<void> => {
    setPhase('rest')
    try {
      if (bellOn(await window.api.app.getSetting(NOTEBOOK_BELL_KEY))) ringBell()
    } catch {
      ringBell()
    }
  }

  const stepTitle = [copy.happenedTitle, copy.keepTitle, copy.tomorrowTitle, copy.closeTitle][step]

  if (phase === 'closed') {
    return (
      <article className="close" lang={review.locale} aria-label={copy.title}>
        <header className="close-head">
          <p className="notebook-kicker">{copy.title}</p>
          <h1 className="notebook-date">{dayHeading(day, review.locale)}</h1>
        </header>
        <section className="close-done" aria-live="polite">
          <p className="close-done-words">{copy.closed}</p>
          <p className="notebook-quiet">{copy.closedHelp}</p>
          {review.line && <blockquote className="notebook-echo-line close-done-line">{review.line}</blockquote>}
          <button type="button" className="notebook-link" onClick={openNotebook}>
            {copy.openNotebook}
          </button>
        </section>
      </article>
    )
  }

  return (
    <article className="close" lang={review.locale} aria-label={copy.title}>
      <header className="close-head">
        <p className="notebook-kicker">{copy.title}</p>
        <h1 className="notebook-date">{dayHeading(day, review.locale)}</h1>
      </header>

      <ol className="close-steps" aria-label={copy.stepOf(step + 1, STEPS)}>
        {copy.steps.map((name, index) => (
          <li key={name} className={index === step ? 'close-step is-current' : index < step ? 'close-step is-past' : 'close-step'} aria-current={index === step ? 'step' : undefined}>
            <span className="close-step-mark" aria-hidden="true" />
            <span className="close-step-name">{name}</span>
          </li>
        ))}
      </ol>

      {/* Keyed by the step: each one fades in on its own. */}
      <section key={step} className="close-body" aria-labelledby="close-step-title">
        <h2 className="close-title" id="close-step-title" ref={heading} tabIndex={-1}>
          {stepTitle}
        </h2>

        {step === 0 &&
          (review.completed.length || review.edited.length ? (
            <div className="close-reviews">
              <ReviewList label={copy.done} items={review.completed} />
              <ReviewList label={copy.edited} items={review.edited} />
            </div>
          ) : (
            <p className="notebook-quiet">{copy.quietDay}</p>
          ))}

        {step === 1 && (
          <>
            <p className="close-help">{review.line ? copy.keepReplace : copy.keepHelp}</p>
            <textarea
              className="notebook-line close-line"
              rows={2}
              value={line}
              maxLength={NOTEBOOK_LIMITS.line}
              placeholder={copy.keepPlaceholder}
              aria-label={copy.keepTitle}
              onChange={(event) => setLine(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void next()
                }
              }}
            />
          </>
        )}

        {step === 2 && (
          <>
            <p className="close-help">{copy.tomorrowHelp}</p>
            <ol className="close-plans">
              {plans.map((plan, index) => (
                <li key={index}>
                  <input
                    className="close-plan"
                    value={plan}
                    maxLength={NOTEBOOK_LIMITS.plan}
                    placeholder={copy.tomorrowPlaceholders[index]}
                    aria-label={copy.tomorrowPlaceholders[index]}
                    onChange={(event) => setPlans((current) => current.map((p, i) => (i === index ? event.target.value : p)))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                        event.preventDefault()
                        void next()
                      }
                    }}
                  />
                </li>
              ))}
            </ol>
          </>
        )}

        {step === 3 && <p className="close-help">{copy.closeHelp}</p>}

        {problem && (
          <p className="close-problem" role="alert">
            {problem === 'ended' ? copy.ended : copy.failed}
          </p>
        )}

        <div className="close-actions">
          {step > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              {copy.back}
            </Button>
          )}
          {step < STEPS - 1 ? (
            <Button variant="primary" disabled={busy} onClick={() => void next()}>
              {copy.next}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void close()}>
              {copy.closeButton}
            </Button>
          )}
        </div>
      </section>

      {phase === 'rest' && <Rest copy={copy} onWake={wake} />}
    </article>
  )
}
