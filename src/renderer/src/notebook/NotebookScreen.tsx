// The ink notebook: today's line, the same date in earlier years, and every day before, in one
// quiet column. Loaded on demand through Host.tsx. Today's line can be rewritten until midnight;
// earlier days are shown and nothing else: there is no control here that would change one, and
// the main process refuses to anyway (shared/notebook.ts).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent as ReactChangeEvent, JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { localDay } from '@shared/briefing'
import { NOTEBOOK_ID, NOTEBOOK_LIMITS, type NotebookEntry, type NotebookView } from '@shared/notebook'
import { COPY, dayHeading, dayShort, weekdayShort, type NotebookCopy } from './copy'
import './notebook.css'

/** A pause in typing this long writes the line. */
const WRITE_DELAY_MS = 800
/** Changes from elsewhere (another window, a sync) arrive in bursts: one reload after they settle. */
const CHANGE_DEBOUNCE_MS = 300
/** Earlier days shown at first, and added by each "earlier still". */
const PAGE = 30

type Status = 'idle' | 'saving' | 'kept' | 'failed' | 'ended'

const isNotebookBlock = (id: string): boolean => id === NOTEBOOK_ID || id.startsWith(`${NOTEBOOK_ID}-`)

function untilMidnight(now: number): number {
  const date = new Date(now)
  return Math.max(1000, new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - now)
}

/** The view with today's entry replaced by what was just written. */
function withToday(view: NotebookView, entry: NotebookEntry): NotebookView {
  const others = view.entries.filter((e) => e.day !== entry.day)
  const entries = entry.text ? [entry, ...others].sort((a, b) => (a.day < b.day ? 1 : -1)) : others
  return { ...view, todayEntry: entry, entries }
}

function TodayLine({ view, copy, onWritten, onEnded }: { view: NotebookView; copy: NotebookCopy; onWritten: (entry: NotebookEntry) => void; onEnded: () => void }): JSX.Element {
  const stored = view.todayEntry?.text ?? ''
  const [draft, setDraft] = useState(stored)
  const [status, setStatus] = useState<Status>('idle')
  const area = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focused = useRef(false)

  // What another window or device wrote shows here, unless this one is being written.
  useEffect(() => {
    if (!focused.current && pending.current === null) setDraft(stored)
  }, [stored])

  // The field grows with its line: no scrollbar inside a sentence.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  const flush = useCallback((): void => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const text = pending.current
    if (text === null) return
    pending.current = null
    // The day may have ended while the line was being written: it stays as it was.
    if (localDay() !== view.today) {
      setStatus('ended')
      onEnded()
      return
    }
    setStatus('saving')
    window.api.notebook.write(view.today, text).then(
      (entry) => {
        onWritten(entry)
        if (pending.current === null) setStatus('kept')
      },
      (error: unknown) => {
        console.error('the line could not be written', error)
        const ended = error instanceof Error && /has ended/.test(error.message)
        setStatus(ended ? 'ended' : 'failed')
        if (ended) onEnded()
        else if (pending.current === null) pending.current = text
      }
    )
  }, [view.today, onWritten, onEnded])

  // Nothing typed is lost when the screen goes away or the window closes.
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])

  const onChange = (event: ReactChangeEvent<HTMLTextAreaElement>): void => {
    const text = event.target.value.slice(0, NOTEBOOK_LIMITS.line)
    setDraft(text)
    pending.current = text
    if (status !== 'saving') setStatus('idle')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, WRITE_DELAY_MS)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter keeps the line; Shift+Enter breaks it, for the rare second sentence.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      flush()
    }
  }

  const note = status === 'failed' ? copy.failed : status === 'ended' ? copy.ended : copy.inkNote
  return (
    <section className="notebook-today" aria-label={copy.todayLabel}>
      <textarea
        ref={area}
        className="notebook-line"
        rows={1}
        value={draft}
        maxLength={NOTEBOOK_LIMITS.line}
        placeholder={copy.placeholder}
        aria-label={copy.placeholder}
        spellCheck
        readOnly={status === 'ended'}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          flush()
        }}
      />
      <div className="notebook-meta">
        <span className={status === 'failed' || status === 'ended' ? 'notebook-note is-alert' : 'notebook-note'} role={status === 'failed' || status === 'ended' ? 'alert' : undefined}>
          {note}
        </span>
        <span className="notebook-status" role="status" aria-live="polite">
          {status === 'saving' ? copy.saving : status === 'kept' ? copy.kept : ''}
        </span>
      </div>
    </section>
  )
}

export function NotebookScreen(): JSX.Element {
  const [view, setView] = useState<NotebookView | null>(null)
  const [failed, setFailed] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const latest = useRef(0)

  const load = useCallback((): void => {
    const ticket = ++latest.current
    window.api.notebook.get().then(
      (next) => {
        if (ticket !== latest.current) return
        setView(next)
        setFailed(false)
      },
      (error: unknown) => {
        if (ticket !== latest.current) return
        console.error('the notebook failed to load', error)
        setFailed(true)
      }
    )
  }, [])

  useEffect(() => {
    load()
    let debounce: ReturnType<typeof setTimeout> | null = null
    // What other windows and other devices write: this window's own writes are already shown.
    const off = window.api.onChange((event) => {
      if (event.origin === window.api.clientId || !event.ids.some(isNotebookBlock)) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(load, CHANGE_DEBOUNCE_MS)
    })
    // A new day: yesterday's line is ink, and today's is blank.
    let midnight: ReturnType<typeof setTimeout>
    const arm = (): void => {
      midnight = setTimeout(() => {
        load()
        arm()
      }, untilMidnight(Date.now()) + 1000)
    }
    arm()
    return () => {
      off()
      if (debounce) clearTimeout(debounce)
      clearTimeout(midnight)
    }
  }, [load])

  const onWritten = useCallback((entry: NotebookEntry) => setView((current) => (current && current.today === entry.day ? withToday(current, entry) : current)), [])

  if (!view) {
    const copy = COPY.en
    return (
      <article className="notebook" aria-busy={!failed}>
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

  const copy = COPY[view.locale]
  const thisYear = Number(view.today.slice(0, 4))
  const earlier = view.entries.filter((entry) => entry.day !== view.today)
  return (
    <article className="notebook" lang={view.locale} aria-label={copy.title}>
      <header className="notebook-head">
        <p className="notebook-kicker">{copy.title}</p>
        <h1 className="notebook-date">{dayHeading(view.today, view.locale)}</h1>
      </header>

      {/* Keyed by the day: at midnight the field starts blank for the new one. */}
      <TodayLine key={view.today} view={view} copy={copy} onWritten={onWritten} onEnded={load} />

      {view.onThisDay.length > 0 && (
        <section className="notebook-section notebook-echoes" aria-labelledby="notebook-echoes">
          <h2 className="notebook-label" id="notebook-echoes">
            {copy.onThisDay}
          </h2>
          <ul className="notebook-echo-list">
            {view.onThisDay.map(({ entry, years }) => (
              <li key={entry.day} className="notebook-echo">
                <p className="notebook-echo-when">
                  <time dateTime={entry.day}>{copy.yearsAgo(years)}</time>
                </p>
                <blockquote className="notebook-echo-line">{entry.text}</blockquote>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="notebook-section" aria-labelledby="notebook-earlier">
        <h2 className="notebook-label" id="notebook-earlier">
          {copy.earlier}
        </h2>
        {earlier.length === 0 ? (
          <p className="notebook-quiet">{copy.empty}</p>
        ) : (
          <ol className="notebook-days">
            {earlier.slice(0, shown).map((entry) => (
              <li key={entry.day} className="notebook-day">
                <time className="notebook-day-date" dateTime={entry.day}>
                  <span>{dayShort(entry.day, view.locale, thisYear)}</span>
                  <span className="notebook-day-weekday">{weekdayShort(entry.day, view.locale)}</span>
                </time>
                <p className="notebook-day-line">{entry.text}</p>
              </li>
            ))}
          </ol>
        )}
        {earlier.length > shown && (
          <button type="button" className="notebook-link" onClick={() => setShown((n) => n + PAGE * 2)}>
            {copy.showMore}
          </button>
        )}
      </section>
    </article>
  )
}
