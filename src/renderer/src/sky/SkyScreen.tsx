// The Sky's screen: a kicker, the moon's phase as the title, the date, this year's sky, one line
// under it (most nights empty), and the skies of earlier years. Only to look at: hovering a star
// reads its line, clicking opens Meditations. What is new since the last look plays once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  earlierSkies,
  echoOf,
  isPassing,
  SKY_EVENT_SHOWN_KEY,
  SKY_FIRST_SHOWN_KEY,
  SKY_LAST_SEEN_KEY,
  SKY_NAMED_SHOWN_KEY,
  SKY_SEEN_AT_KEY,
  skyScene,
  type SkyScene,
  type SkyView
} from '@shared/sky'
import { openNotebook } from '@/notebook/route'
import { COPY, longDay } from './copy'
import { useReducedMotion } from './motion'
import { SkyChart } from './SkyChart'
import type { SkyPlay } from './timeline'
import './sky.css'

const newest = (scene: SkyScene): string | null => {
  let day: string | null = null
  for (const m of scene.months) for (const s of m.stars) if (!day || s.day > day) day = s.day
  return day
}

/** The newest past month that has a name under its figure. */
const newestNamed = (scene: SkyScene): string | null => {
  const named = scene.months.filter((m) => m.label).map((m) => m.month)
  return named.length ? named[named.length - 1] : null
}

function remember(key: string, value: unknown): void {
  window.api.app.setSetting(key, value).catch((error: unknown) => console.error(`the sky could not remember ${key}`, error))
}

/** What the first look of this opening plays, from what this computer last saw. */
function openingPlay(view: SkyView, scene: SkyScene): SkyPlay | null {
  const { local } = view
  const play: SkyPlay = { delay: 2.5 }
  if (!local.firstShown) {
    if (scene.months.length === 0) return null
    return { first: true, delay: 1 }
  }
  const stars = scene.months.flatMap((m) => m.stars).filter((s) => !local.lastSeen || s.day > local.lastSeen)
  if (stars.length) play.stars = stars.map((s) => s.day).sort()
  const named = scene.months.filter((m) => m.label && (!local.namedShown || m.month > local.namedShown)).map((m) => m.month)
  if (named.length && local.namedShown) play.named = named.slice(-1)
  if (local.seenAt > 0) {
    const grains = scene.grains.filter((g) => g.at > local.seenAt).map((g) => g.key)
    const halos = scene.halos.filter((h) => h.at > local.seenAt).map((h) => h.key)
    if (grains.length) play.grains = grains
    if (halos.length) play.halos = halos
  }
  if (scene.event && isPassing(scene.event) && local.eventShown !== view.today) play.event = true
  return play.stars || play.named || play.grains || play.halos || play.event ? play : null
}

/** What changed while the screen was open, to play at once. */
function changesPlay(before: SkyScene, after: SkyScene): SkyPlay | null {
  const days = new Set(before.months.flatMap((m) => m.stars.map((s) => s.day)))
  const grains = new Set(before.grains.map((g) => g.key))
  const halos = new Set(before.halos.map((h) => h.key))
  const play: SkyPlay = {}
  const stars = after.months.flatMap((m) => m.stars).filter((s) => !days.has(s.day))
  if (stars.length) play.stars = stars.map((s) => s.day).sort()
  const newGrains = after.grains.filter((g) => !grains.has(g.key)).map((g) => g.key)
  const newHalos = after.halos.filter((h) => !halos.has(h.key)).map((h) => h.key)
  if (newGrains.length) play.grains = newGrains
  if (newHalos.length) play.halos = newHalos
  return play.stars || play.grains || play.halos ? play : null
}

export function SkyScreen(): JSX.Element {
  const [view, setView] = useState<SkyView | null>(null)
  const [problem, setProblem] = useState(false)
  const [year, setYear] = useState<number | null>(null)
  const [play, setPlay] = useState<{ key: number; play: SkyPlay } | null>(null)
  const reduced = useReducedMotion()
  const shown = useRef<SkyScene | null>(null)
  const opened = useRef(false)
  const plays = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await window.api.sky.view()
      setView(next)
      setProblem(false)
    } catch (error) {
      console.error('the sky could not be read', error)
      setProblem(true)
    }
  }, [])

  useEffect(() => {
    void load()
    let timer: number | undefined
    const later = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void load(), 400)
    }
    const offSky = window.api.sky.onChanged(later)
    // A line written, a task done, in this window or another: the sky may have grown.
    const offChange = window.api.onChange(later)
    return () => {
      window.clearTimeout(timer)
      offSky()
      offChange()
    }
  }, [load])

  const thisYear = view ? Number(view.today.slice(0, 4)) : null
  const scene = useMemo(() => (view ? skyScene(view, thisYear!, view.today, { events: view.events }) : null), [view, thisYear])
  const shownYear = year ?? thisYear
  const other = useMemo(
    () => (view && shownYear !== null && shownYear !== thisYear ? skyScene(view, shownYear, view.today) : null),
    [view, shownYear, thisYear]
  )

  // What plays: once on opening, then whatever arrives while the screen is open.
  useEffect(() => {
    if (!view || !scene) return
    let next: SkyPlay | null = null
    if (!opened.current) {
      opened.current = true
      next = openingPlay(view, scene)
      const { local } = view
      if (!local.firstShown) remember(SKY_FIRST_SHOWN_KEY, true)
      if (next?.event) {
        remember(SKY_EVENT_SHOWN_KEY, view.today)
        void window.api.sky.moment({ kind: 'night' }).catch(() => undefined)
      }
      const named = newestNamed(scene)
      if (next?.named?.length)
        void window.api.sky.moment({ kind: 'named', month: next.named[next.named.length - 1] }).catch(() => undefined)
      if (named && named !== local.namedShown) remember(SKY_NAMED_SHOWN_KEY, named)
    } else if (shown.current) {
      next = changesPlay(shown.current, scene)
    }
    shown.current = scene
    const latest = newest(scene)
    if (latest && latest !== view.local.lastSeen) remember(SKY_LAST_SEEN_KEY, latest)
    remember(SKY_SEEN_AT_KEY, Date.now())
    if (next) setPlay({ key: ++plays.current, play: next })
  }, [view, scene])

  // Esc goes back to tonight's sky.
  useEffect(() => {
    if (year === null) return
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setYear(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [year])

  const done = useCallback(() => setPlay(null), [])

  if (problem && !view) {
    const copy = COPY.en
    return (
      <div className="sky">
        <div className="sky-problem">
          <p>{copy.loadFailed}</p>
          <button type="button" className="sky-link" onClick={() => void load()}>
            {copy.tryAgain}
          </button>
        </div>
      </div>
    )
  }
  if (!view || !scene || thisYear === null) return <div className="sky" aria-busy="true" />

  const copy = COPY[view.locale]
  const looking = other ?? scene
  const earlier = earlierSkies(view, thisYear)
  const echo = echoOf(view, view.today)
  const empty = view.meditations.length === 0
  const caption = other ? null : empty ? null : echo ? echo : scene.event ? copy.eventCaption(scene.event) : null

  return (
    <div className="sky is-opening">
      <header className="sky-head">
        <p className="sky-kicker">{copy.kicker}</p>
        <h1 className="sky-title">{other ? copy.skyOf(shownYear!) : copy.phase[scene.moon.phaseIndex]}</h1>
        {!other && (
          <p className="sky-date" data-date="">
            {longDay(view.today, view.locale)}
          </p>
        )}
      </header>

      <SkyChart
        scene={looking}
        copy={copy}
        locale={view.locale}
        play={other ? null : (play?.play ?? null)}
        playKey={other ? `y${shownYear}` : (play?.key ?? 0)}
        reduced={reduced}
        onOpenNotebook={openNotebook}
        onPlayed={done}
      />

      <p className="sky-caption">
        {empty && !other ? (
          <>
            {copy.empty}{' '}
            <button type="button" className="sky-link" onClick={openNotebook}>
              {copy.emptyLink}
            </button>
          </>
        ) : caption && typeof caption === 'object' ? (
          <button type="button" onClick={() => setYear(Number(caption.day.slice(0, 4)))}>
            {copy.echo(caption.years, caption.text)}
          </button>
        ) : (
          caption
        )}
      </p>

      {other && (
        <button type="button" className="sky-link sky-back" onClick={() => setYear(null)}>
          {copy.backToNow}
        </button>
      )}

      {earlier.length > 0 && (
        <section className="sky-earlier" aria-label={copy.earlierSkies}>
          <h2 className="sky-earlier-title">{copy.earlierSkies}</h2>
          <ul className="sky-earlier-list">
            {earlier.map((y) => (
              <li key={y}>
                <button
                  type="button"
                  className="sky-earlier-item"
                  aria-pressed={shownYear === y}
                  onClick={() => setYear(shownYear === y ? null : y)}
                >
                  <SkyChart scene={skyScene(view, y, view.today)} copy={copy} locale={view.locale} reduced={reduced} small />
                  <span>{copy.skyOf(y)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
