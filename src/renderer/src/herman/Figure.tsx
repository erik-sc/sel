// Herman, drawn: one line (and its soft halo) that takes the shape of a pose. Changing the
// pose changes the `d` of the same path, which CSS interpolates: no animation loop runs here.
// What moves by itself is driven by plain timers seconds apart (a breath, now and then a blink,
// the two mouth shapes while he speaks), and those stop while the window is hidden or not in front.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { PATHS, THOUGHT_PATH, VIEW_BOX, Z_PATH, type Pose } from './poses'
import './herman.css'

export type FigurePose = Exclude<Pose, 'speaking2' | 'blink'>

export interface FigureProps {
  pose: FigurePose
  /** Draws himself in one stroke when he appears. */
  draw?: boolean
  /** Breathes and blinks. Off for figures that are only an illustration. */
  alive?: boolean
  className?: string
}

/** One breath in this long; between two breaths nothing of him moves. */
const BREATH_EVERY_MS = 8400
const BREATH_HOLD_MS = 1500
/** Every third breath is followed by a blink. */
const BLINK_EVERY = 3
const BLINK_AFTER_MS = 1500
const BLINK_MS = 150
const BLINK_SETTLE_MS = 260
const MOUTH_MS = 640

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const attentive = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()

/** True while the window is visible and in front: nothing of his moves otherwise. */
function useAttentive(): boolean {
  const [value, setValue] = useState(attentive)
  useEffect(() => {
    const update = (): void => setValue(attentive())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return value
}

/**
 * The small signs of life: every eight seconds or so one slow breath, and after every third a
 * blink. One timer at a time, none while `active` is false, and no animation loop: each step
 * sets a class and the stylesheet does the moving. `quick` outlasts the blink itself, so that
 * the eyes open again as fast as they closed.
 */
function useLife(active: boolean, blinks: boolean): { breath: boolean; blink: boolean; quick: boolean } {
  const [breath, setBreath] = useState(false)
  const [blink, setBlink] = useState(false)
  const [quick, setQuick] = useState(false)
  useEffect(() => {
    if (!active) {
      setBreath(false)
      setBlink(false)
      setQuick(false)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    let beat = 0
    const after = (ms: number, step: () => void): void => {
      timer = setTimeout(step, ms)
    }
    const rest = (): void => after(BREATH_EVERY_MS - BREATH_HOLD_MS, inhale)
    const inhale = (): void => {
      setBreath(true)
      after(BREATH_HOLD_MS, exhale)
    }
    const exhale = (): void => {
      setBreath(false)
      if (blinks && ++beat % BLINK_EVERY === 0) after(BLINK_AFTER_MS, close)
      else rest()
    }
    const close = (): void => {
      setBlink(true)
      setQuick(true)
      after(BLINK_MS, open)
    }
    const open = (): void => {
      setBlink(false)
      after(BLINK_SETTLE_MS, () => {
        setQuick(false)
        rest()
      })
    }
    rest()
    return () => clearTimeout(timer)
  }, [active, blinks])
  return { breath, blink, quick }
}

/** While he speaks, his mouth alternates between two shapes. */
function useMouth(speaking: boolean): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!speaking) {
      setOpen(false)
      return
    }
    const timer = setInterval(() => setOpen((value) => !value), MOUTH_MS)
    return () => clearInterval(timer)
  }, [speaking])
  return open
}

const shape = (d: string): CSSProperties => ({ d: `path("${d}")` }) as CSSProperties

export function Figure({ pose, draw = false, alive = true, className }: FigureProps): JSX.Element {
  const [reduced] = useState(reducedMotion)
  const front = useAttentive()
  const moving = alive && front && !reduced
  const { breath, blink, quick } = useLife(moving && (pose === 'resting' || pose === 'sleeping'), pose === 'resting')
  const mouth = useMouth(moving && pose === 'speaking')
  const shown: Pose = pose === 'speaking' && mouth ? 'speaking2' : pose === 'resting' && blink ? 'blink' : pose

  // Reduced motion: the line does not travel from one pose to the next; the old pose fades out
  // under the new one instead.
  const last = useRef<FigurePose>(pose)
  const [leaving, setLeaving] = useState<FigurePose | null>(null)
  useEffect(() => {
    if (last.current === pose) return
    const previous = last.current
    last.current = pose
    if (!reduced) return
    setLeaving(previous)
    const timer = setTimeout(() => setLeaving(null), 400)
    return () => clearTimeout(timer)
  }, [pose, reduced])

  const classes = ['herman-figure', `is-${pose}`]
  if (draw) classes.push('is-drawn')
  if (breath) classes.push('is-breathing')
  if (quick) classes.push('is-blinking')
  if (className) classes.push(className)
  const d = PATHS[shown]

  return (
    <svg className={classes.join(' ')} viewBox={VIEW_BOX} aria-hidden="true" focusable="false">
      {leaving && <path key={`leaving-${leaving}`} className="herman-line is-leaving" d={PATHS[leaving]} />}
      <g key={reduced ? pose : 'figure'} className="herman-body">
        <path className="herman-halo" pathLength={1} d={d} style={shape(d)} />
        <path className="herman-line" pathLength={1} d={d} style={shape(d)} />
      </g>
      <path className="herman-mark herman-z" d={Z_PATH} />
      <path className="herman-mark herman-thought" pathLength={1} d={THOUGHT_PATH} />
    </svg>
  )
}
