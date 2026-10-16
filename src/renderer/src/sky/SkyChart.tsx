// The sky of one year, drawn from a scene (shared/sky skyScene): every position comes ready, and
// this only draws it, in line, like an old star chart. Used by the Sky's screen (the big sky and
// the miniatures of earlier years) and by the rest at the end of Close the day.
// What moves is decided by a timeline (./timeline.ts); with nothing to play, nothing moves, but
// for the rings of "on this day" and the fireflies of a summer night.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { addDays, CHART_ARCS, CHART_MERIDIANS, rng, SKY_HEIGHT, SKY_WIDTH, WHEEL, WHEEL_TICKS, type SkyMonth, type SkyScene, type SkyStar } from '@shared/sky'
import type { NotebookLocale } from '@shared/notebook'
import { longDay, type SkyCopy } from './copy'
import { segmentKey, timeline, type SkyPlay, type Timing } from './timeline'

export interface SkyChartProps {
  scene: SkyScene
  copy: SkyCopy
  locale: NotebookLocale
  /** What to play this time; null draws the sky still. */
  play?: SkyPlay | null
  /** Changes when the same play should run again. */
  playKey?: string | number
  /** The user asked for less motion: nothing travels; what is new is simply there. */
  reduced?: boolean
  /** A miniature: no tooltips, no names, bolder dots. */
  small?: boolean
  /** Clicking a star or a month's name. */
  onOpenNotebook?: () => void
  /** The play has run to its end. */
  onPlayed?: () => void
  className?: string
}

const r1 = (v: number): number => Math.round(v * 10) / 10
const tm = (t: Timing | null | undefined): CSSProperties | undefined => (t ? ({ '--n': t.n, '--w': t.w } as CSSProperties) : undefined)
const DURATION_MS = 300

/** A four-pointed glint around (x, y). */
function glint(x: number, y: number, r: number): string {
  return (
    `M${r1(x)} ${r1(y - r)}Q${r1(x + 1)} ${r1(y - 1)} ${r1(x + r)} ${r1(y)}Q${r1(x + 1)} ${r1(y + 1)} ${r1(x)} ${r1(y + r)}` +
    `Q${r1(x - 1)} ${r1(y + 1)} ${r1(x - r)} ${r1(y)}Q${r1(x - 1)} ${r1(y - 1)} ${r1(x)} ${r1(y - r)}Z`
  )
}

function ring(x: number, y: number, r: number): string {
  return `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(r * 2)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-r * 2)} 0`
}

const line = (a: { x: number; y: number }, b: { x: number; y: number }): string => `M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}`

/** The pixel size of one unit of the drawing, so that strokes stay 1–1.4 px at any size. */
function usePx(ref: React.RefObject<HTMLDivElement | null>): number {
  const [px, setPx] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      const width = el.getBoundingClientRect().width
      if (width > 0) setPx(SKY_WIDTH / width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return px
}

export function SkyChart({ scene, copy, locale, play = null, playKey, reduced = false, small = false, onOpenNotebook, onPlayed, className }: SkyChartProps): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const px = usePx(box)
  const clip = useId().replace(/:/g, '')
  const active = reduced ? null : play
  const t = useMemo(() => timeline(scene, active), [scene, active])
  const playing = !!active
  const [hover, setHover] = useState<SkyStar | null>(null)
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  // Dots are drawn bigger in a miniature, where a unit is a fraction of a pixel.
  const k = small ? Math.min(3, Math.max(1, px * 0.75)) : 1

  useEffect(() => {
    if (!play) return
    const ms = reduced ? 500 : t.end * DURATION_MS + 200
    const timer = window.setTimeout(() => onPlayed?.(), ms)
    return () => window.clearTimeout(timer)
    // playKey restarts the same play
  }, [play, playKey, reduced, t.end, onPlayed])

  const event = scene.event
  const eventOn = !!t.event
  const style = { '--px': String(px) } as CSSProperties

  return (
    <div ref={box} className={['sky-chart', small ? 'is-small' : '', className ?? ''].join(' ').trim()} style={style}>
      <svg
        key={playKey}
        className={['sky-svg', playing ? 'sky-play' : '', reduced && play ? 'sky-reduced-play' : ''].join(' ').trim()}
        viewBox={`0 0 ${SKY_WIDTH} ${SKY_HEIGHT}`}
        role="img"
        aria-label={copy.chartLabel}
      >
        <defs>
          <clipPath id={`${clip}-box`}>
            <rect x="0" y="0" width={SKY_WIDTH} height={SKY_HEIGHT} />
          </clipPath>
          <clipPath id={`${clip}-moon`}>
            <circle cx={scene.moon.x} cy={scene.moon.y} r={scene.moon.r} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip}-box)`} className="sky-root">
          {/* the chart: three arcs and five meridians, very faint */}
          <g className="sky-grid">
            {CHART_ARCS.map((d, i) => (
              <path
                key={`a${i}`}
                className={['grid-l', t.arcs ? 'dash' : '', eventOn && event?.kind === 'season' ? 'sweep' : ''].join(' ').trim()}
                pathLength={1}
                d={d}
                style={tm(t.arcs ? { w: t.arcs.w + i, n: t.arcs.n } : eventOn && event?.kind === 'season' ? { w: t.event!.w + i * 1.5, n: 10 } : null)}
              />
            ))}
            {CHART_MERIDIANS.map((d, i) => (
              <path key={`m${i}`} className={t.arcs ? 'grid-l fade' : 'grid-l'} d={d} style={tm(t.arcs ? { w: t.arcs.w + 2, n: 3 } : null)} />
            ))}
            <ellipse className={t.arcs ? 'wheel dash' : 'wheel'} pathLength={1} cx={WHEEL.cx} cy={WHEEL.cy} rx={WHEEL.rx} ry={WHEEL.ry} style={tm(t.arcs ? { w: t.arcs.w + 1, n: 6 } : null)} />
            {WHEEL_TICKS.map((d, i) => (
              <path key={`t${i}`} className={t.arcs ? 'tick fade' : 'tick'} d={d} style={tm(t.arcs ? { w: t.arcs.w + 3, n: 3 } : null)} />
            ))}
          </g>

          {/* background stars: they mean nothing */}
          <g className={t.field ? 'fade' : undefined} style={tm(t.field)}>
            {scene.field.map((s, i) => (
              <circle key={i} className={i >= 60 ? 'fs is-dark' : 'fs'} cx={s.x} cy={s.y} r={r1(s.r * k)} />
            ))}
          </g>

          {/* the Milky Way: the dust of completed tasks */}
          <g className="sky-dust">
            {scene.grains.map((g) => {
              const timing = t.grains.get(g.key)
              const arriving = timing && timing.n === 5
              return (
                <g key={g.key}>
                  {arriving && <path className="trail" pathLength={1} d={`M${r1(g.x + 26)} ${r1(g.y + 18)}L${g.x} ${g.y}`} style={tm({ w: timing.w, n: 4 })} />}
                  <circle className={['grain', arriving ? 'land' : timing ? 'fade' : ''].join(' ').trim()} cx={g.x} cy={g.y} r={r1(g.r * k)} style={tm(timing)} />
                </g>
              )
            })}
          </g>

          {/* the months */}
          {scene.months.map((m) => (
            <Month key={m.month} month={m} t={t} k={k} small={small} onHover={setHover} onOpen={onOpenNotebook} />
          ))}

          {/* the halos of pomodoros */}
          {scene.halos.map((h) => {
            const timing = t.halos.get(h.key)
            return <path key={h.key} className={['halo', timing ? (timing.n === 5 ? 'settle' : 'fade') : ''].join(' ').trim()} pathLength={1} d={ring(h.x, h.y, h.r)} style={tm(timing)} />
          })}

          {/* the first star of all, for good */}
          {scene.firstStar && (
            <g className="first-star">
              <path className="cl glint" d={glint(scene.firstStar.x, scene.firstStar.y, 7 * k)} />
              {event?.kind === 'anniversary' && (
                <>
                  <path className="cl glint is-strong" d={glint(scene.firstStar.x, scene.firstStar.y, 11 * k)} />
                  {eventOn && <path className="sparkle" d={glint(scene.firstStar.x, scene.firstStar.y, 14)} style={tm({ w: t.event!.w, n: 4.5 })} />}
                  <circle className="accent-star" cx={scene.firstStar.x} cy={scene.firstStar.y} r={2.2 * k} />
                </>
              )}
            </g>
          )}

          {/* on this day: the star of this date, years ago */}
          {scene.echo && (
            <g className="echo">
              <circle className="accent-star" cx={scene.echo.x} cy={scene.echo.y} r={r1(1.9 * k)} />
              <circle className={reduced ? 'ring' : 'ring pulse'} cx={scene.echo.x} cy={scene.echo.y} r={7 * Math.min(k, 1.6)} />
              {!reduced && <circle className="ring pulse is-late" cx={scene.echo.x} cy={scene.echo.y} r={7 * Math.min(k, 1.6)} />}
            </g>
          )}

          <Moon scene={scene} clip={`${clip}-moon`} t={t} reduced={reduced} />

          {!small && <Night scene={scene} t={t} reduced={reduced} />}

          {/* 10: the shooting star of a pomodoro */}
          {t.meteor && (
            <g className="ephemeral">
              <path className="meteor-tail" pathLength={1} d="M760 30L470 150" style={tm({ w: t.meteor.w, n: 4.4 })} />
              <path className="meteor" pathLength={1} d="M760 30L470 150" style={tm(t.meteor)} />
            </g>
          )}
        </g>
      </svg>

      {!small && (
        <>
          {scene.months.map((m) =>
            m.label ? (
              <MonthName
                key={m.month}
                month={m}
                timing={t.labels.get(m.month)}
                open={openMonth === m.month}
                copy={copy}
                onOpenChange={(open) => setOpenMonth(open ? m.month : null)}
                onOpen={onOpenNotebook}
              />
            ) : null
          )}
          {hover && (
            <div className="sky-tip" role="tooltip" style={{ left: `${(hover.x / SKY_WIDTH) * 100}%`, top: `${(hover.y / SKY_HEIGHT) * 100}%` }}>
              <span className="sky-tip-day" data-date="">
                {longDay(hover.day, locale)}
              </span>
              <span className="sky-tip-line">{hover.text}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Month({
  month,
  t,
  k,
  small,
  onHover,
  onOpen
}: {
  month: SkyMonth
  t: ReturnType<typeof timeline>
  k: number
  small: boolean
  onHover: (star: SkyStar | null) => void
  onOpen?: () => void
}): JSX.Element {
  const handoffs = new Map<string, Timing>()
  for (const s of t.stars.values()) if (s.handoff) handoffs.set(s.handoff, { w: s.start, n: 4 })
  return (
    <g className="sky-month" data-month={month.month}>
      {month.segments.map((s) => {
        const timing = t.segments.get(segmentKey(month.month, s.ia, s.ib))
        const cls = timing ? (timing.mode === 'dash' ? 'cl dash' : 'cl glowline') : 'cl'
        // drawn from the earlier star to the one that completes it, the way the pen goes
        return <path key={`${s.ia}-${s.ib}`} className={cls} pathLength={1} d={s.ia < s.ib ? line(s.a, s.b) : line(s.b, s.a)} style={tm(timing)} />
      })}
      {month.stars.map((s) => {
        const fresh = t.stars.get(s.day)
        const reveal = t.reveal.get(s.day)
        const breathe = t.breathe.get(s.day)
        const handoff = handoffs.get(s.day)
        const r = r1((s.loose ? 1.3 : 1.9) * k)
        const cls = fresh ? (s.loose ? 'n-star is-loose pop' : 'n-star pop') : reveal ? 'st pop' : breathe ? 'st breathe' : handoff ? 'st handoff' : s.loose ? 'st is-loose' : 'st'
        return (
          <g key={s.day}>
            {fresh && <path className="sparkle" d={glint(s.x, s.y, 10)} style={tm({ w: fresh.w - 0.4, n: 4.5 })} />}
            <circle className={cls} cx={s.x} cy={s.y} r={r} style={tm(fresh ?? reveal ?? breathe ?? handoff)} data-day={s.day} />
            {!small && (
              <circle
                className="hit"
                cx={s.x}
                cy={s.y}
                r={9}
                onPointerEnter={() => onHover(s)}
                onPointerLeave={() => onHover(null)}
                onClick={() => onOpen?.()}
              />
            )}
          </g>
        )
      })}
    </g>
  )
}

function MonthName({
  month,
  timing,
  open,
  copy,
  onOpenChange,
  onOpen
}: {
  month: SkyMonth
  timing: Timing | undefined
  open: boolean
  copy: SkyCopy
  onOpenChange: (open: boolean) => void
  onOpen?: () => void
}): JSX.Element {
  const lines = month.stars.map((s) => s.text)
  const style: CSSProperties = {
    left: `${(month.centre.x / SKY_WIDTH) * 100}%`,
    top: `${((month.centre.y + 38) / SKY_HEIGHT) * 100}%`,
    ...(timing ? ({ '--n': timing.n, '--w': timing.w } as CSSProperties) : {})
  }
  return (
    <div className="sky-name-slot" style={style}>
      <button
        type="button"
        className={timing ? 'sky-name write' : 'sky-name'}
        onPointerEnter={() => onOpenChange(true)}
        onPointerLeave={() => onOpenChange(false)}
        onFocus={() => onOpenChange(true)}
        onBlur={() => onOpenChange(false)}
        onClick={() => onOpen?.()}
        aria-describedby={open ? `sky-lines-${month.month}` : undefined}
      >
        {month.label}
      </button>
      {open && (
        <div className="sky-lines" id={`sky-lines-${month.month}`} role="tooltip">
          {lines.slice(0, 4).map((text, i) => (
            <p key={i}>{text}</p>
          ))}
          {lines.length > 4 && <p className="sky-lines-more">{copy.moreLines}</p>}
        </div>
      )}
    </div>
  )
}

function Moon({ scene, clip, t, reduced }: { scene: SkyScene; clip: string; t: ReturnType<typeof timeline>; reduced: boolean }): JSX.Element {
  const { moon, event } = scene
  const eclipse = event?.kind === 'eclipse'
  const halo = event?.kind === 'halo'
  return (
    <g className={t.moon ? 'sky-moon rise' : 'sky-moon'} style={tm(t.moon)}>
      {halo && (
        <>
          <path className={t.event ? 'halo moon-halo settle' : 'halo moon-halo'} pathLength={1} d={ring(moon.x, moon.y, moon.r * 2.4)} style={tm(t.event ? { w: t.event.w, n: 10 } : null)} />
          <path className={t.event ? 'halo moon-halo is-thin settle' : 'halo moon-halo is-thin'} pathLength={1} d={ring(moon.x, moon.y, moon.r * 2.6)} style={tm(t.event ? { w: t.event.w + 1, n: 10 } : null)} />
        </>
      )}
      <circle className="moonr" cx={moon.x} cy={moon.y} r={moon.r} />
      {eclipse ? (
        <>
          <circle className="moonw" cx={moon.x} cy={moon.y} r={moon.r} />
          <g clipPath={`url(#${clip})`}>
            {t.event && !reduced && <circle className="umbra shadow" cx={moon.x + 3} cy={moon.y} r={moon.r * 1.15} style={tm({ w: t.event.w, n: 16 })} />}
            <circle className={t.event && !reduced ? 'copper fade' : 'copper'} cx={moon.x} cy={moon.y} r={moon.r} style={tm(t.event ? { w: t.event.w + 10, n: 8 } : null)} />
          </g>
          <circle className="moonl" cx={moon.x} cy={moon.y} r={moon.r} />
        </>
      ) : (
        <>
          {moon.phaseIndex !== 0 && <path className="moonw" d={moon.lit} />}
          <path className="moonl" d={moon.lit} />
        </>
      )}
    </g>
  )
}

/** The rare nights: what stays (a comet, fireflies) and what passes once (meteors, a cloud…). */
function Night({ scene, t, reduced }: { scene: SkyScene; t: ReturnType<typeof timeline>; reduced: boolean }): JSX.Element | null {
  const event = scene.event
  if (!event) return null
  const day = scene.night
  const w = t.event?.w ?? 0
  const passing = !!t.event && !reduced

  switch (event.kind) {
    case 'comet': {
      const arrival = addDays(day, -event.night)
      const r = rng('sel-sky-comet:' + arrival)
      // somewhere above the wheel's middle, moving a little each night
      const x = 230 + r() * 340 + event.night * 12
      const y = 120 + r() * 50 - event.night * 4
      const away = Math.atan2(y - scene.moon.y, x - scene.moon.x)
      const tails = [-0.18, 0, 0.16].map((da, i) => {
        const a = away + da
        const len = 60 + i * 8
        const cx = x + Math.cos(a) * len * 0.5
        const cy = y + Math.sin(a) * len * 0.5 + (i - 1) * 3
        return `M${r1(x)} ${r1(y)}Q${r1(cx)} ${r1(cy)} ${r1(x + Math.cos(a) * len)} ${r1(y + Math.sin(a) * len)}`
      })
      return (
        <g className={passing ? 'comet cometmove' : 'comet'} style={tm(passing ? { w, n: 10 } : null)}>
          {tails.map((d, i) => (
            <path key={i} className="comet-tail" d={d} />
          ))}
          <circle className="comet-head" cx={r1(x)} cy={r1(y)} r={2.2} />
        </g>
      )
    }
    case 'fireflies': {
      const r = rng('sel-sky-flies:' + day)
      return (
        <g className="fireflies">
          {Array.from({ length: 7 }, (_, i) => {
            const style = { '--d': `${r1(2.4 + r() * 3)}s`, '--o': `${r1(-r() * 4)}s` } as CSSProperties
            return <circle key={i} className={reduced ? 'fly is-still' : 'fly flicker'} cx={r1(60 + r() * 680)} cy={r1(420 + r() * 30)} r={1.3} style={style} />
          })}
        </g>
      )
    }
    default:
      break
  }
  if (!passing) return null

  switch (event.kind) {
    case 'meteors': {
      const r = rng('sel-sky-shower:' + day)
      const rx = 560 + r() * 160
      const ry = 50 + r() * 40
      return (
        <g className="ephemeral">
          {Array.from({ length: 8 }, (_, i) => {
            const a = 2.0 + r() * 1.1
            const len = 70 + r() * 90
            const x0 = rx + Math.cos(a) * (12 + r() * 30)
            const y0 = ry + Math.sin(a) * (8 + r() * 20)
            return <path key={i} className="meteor" pathLength={1} d={`M${r1(x0)} ${r1(y0)}L${r1(x0 + Math.cos(a) * len)} ${r1(y0 + Math.sin(a) * len)}`} style={tm({ w: w + i * 2.2 + r() * 1.5, n: 3.4 })} />
          })}
        </g>
      )
    }
    case 'shooting-star':
      return (
        <g className="ephemeral">
          <path className="meteor-tail" pathLength={1} d="M120 60L520 220" style={tm({ w, n: 5 })} />
          <path className="meteor" pathLength={1} d="M120 60L520 220" style={tm({ w, n: 4.6 })} />
        </g>
      )
    case 'satellite':
      return (
        <g className="ephemeral across" style={{ '--n': 40, '--w': w, '--from': '-40px', '--to': '860px' } as CSSProperties}>
          <circle className="sat" cx={0} cy={118} r={1.2} />
        </g>
      )
    case 'cloud':
      return (
        <g className="ephemeral across" style={{ '--n': 44, '--w': w, '--from': '-160px', '--to': '880px' } as CSSProperties}>
          <path className="cloud" transform="translate(0 150) scale(4)" d="M7 18.5a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.3A4.7 4.7 0 0 1 17 18.5Z" />
        </g>
      )
    case 'flock':
      return (
        <g className="ephemeral across" style={{ '--n': 30, '--w': w, '--from': '860px', '--to': '-120px' } as CSSProperties}>
          {[
            [0, 0],
            [14, 8],
            [14, -8],
            [28, 16],
            [28, -16]
          ].map(([dx, dy], i) => (
            <path key={i} className="bird" d={`M${dx} ${130 + dy}q4 -5 8 -1.5q4 -3.5 8 1.5`} />
          ))}
        </g>
      )
    case 'new-year':
      return (
        <g className="ephemeral">
          {[
            [170, 380, 0.5],
            [470, 340, 3],
            [640, 400, 5.5]
          ].flatMap(([x, y, d]) =>
            Array.from({ length: 10 }, (_, i) => {
              const a = (i / 10) * Math.PI * 2
              return <path key={`${x}-${i}`} className="burst" pathLength={1} d={`M${r1(x + Math.cos(a) * 5)} ${r1(y + Math.sin(a) * 5)}L${r1(x + Math.cos(a) * 20)} ${r1(y + Math.sin(a) * 20)}`} style={tm({ w: w + d, n: 5 })} />
            })
          )}
        </g>
      )
    default:
      return null
  }
}
