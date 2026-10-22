// The pomodoro in the lower right corner of the content: the phase and the time left, quiet
// enough to stay on screen in focus mode. A click opens its controls; at the end of a phase it
// asks before the next one begins. Where exactly it sits is worked out by ./corner.ts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import { formatClock, nextPhase, phaseMinutes, remaining, type PomodoroSnapshot } from '@shared/pomodoro'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Popover } from '@/ui/Popover'
import { useToasts } from '@/ui/toast'
import { useUi } from '@/store/ui'
import { COPY } from './copy'
import { placeWidget, type Box, type CornerPlace } from './corner'
import { pomodoro, setPomodoroMenu, usePomodoro } from './gate'
import './pomodoro.css'

export function Widget(): JSX.Element | null {
  const snapshot = usePomodoro((state) => state.snapshot)
  const menuOpen = usePomodoro((state) => state.menuOpen)
  const ref = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLButtonElement>(null)
  const timer = snapshot?.timer ?? null
  const running = !!timer && !timer.paused && !timer.ended
  const now = useSecond(running, timer?.endsAt ?? null)
  const place = useCorner(ref, timer?.ended ?? false)

  // The question takes the place of the controls: nothing to pause in a phase that is over.
  useEffect(() => {
    if (timer?.ended) setPomodoroMenu(false)
  }, [timer?.ended])

  if (!snapshot || !timer) return null
  const copy = COPY[snapshot.locale]
  const style = place ? { right: place.right, bottom: place.bottom } : { visibility: 'hidden' as const }
  const classes = ['pomodoro', `is-${timer.phase}`]

  if (timer.ended) {
    const next = nextPhase(timer, snapshot.settings)
    classes.push('is-asking')
    return (
      <div ref={ref} className={classes.join(' ')} style={style} role="group" aria-label="Pomodoro">
        <p className="pomodoro-question" role="status">
          {copy.ask(next, phaseMinutes(next, snapshot.settings))}
        </p>
        <div className="pomodoro-actions">
          <button type="button" className="is-primary" onClick={() => void pomodoro('next')}>
            {copy.start}
          </button>
          {next !== 'focus' && (
            <button type="button" onClick={() => void pomodoro('skip')}>
              {copy.skipBreak}
            </button>
          )}
          <button type="button" onClick={() => void pomodoro('stop')}>
            {copy.stop}
          </button>
        </div>
      </div>
    )
  }

  const left = remaining(timer, now)
  const clock = formatClock(left)
  const done = timer.duration > 0 ? 1 - left / timer.duration : 0
  if (timer.paused) classes.push('is-paused')
  const phase = copy.phase[timer.phase]

  return (
    <div ref={ref} className={classes.join(' ')} style={style}>
      <button
        ref={pill}
        type="button"
        className="pomodoro-pill"
        aria-label={copy.label(phase, clock)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setPomodoroMenu(!menuOpen)}
      >
        <Ring done={done} />
        <span className="pomodoro-phase">{timer.paused ? copy.paused : phase}</span>
        <span className="pomodoro-clock">{clock}</span>
      </button>
      <Popover
        anchor={pill.current}
        open={menuOpen}
        onClose={() => setPomodoroMenu(false)}
        placement="top-start"
        role="none"
        className="pomodoro-menu"
      >
        <Menu items={menuItems(snapshot, copy)} autoFocus onClose={() => setPomodoroMenu(false)} />
      </Popover>
    </div>
  )
}

function menuItems(snapshot: PomodoroSnapshot, copy: (typeof COPY)['en']): MenuItem[] {
  const timer = snapshot.timer!
  const every = snapshot.settings.longEvery
  const header = timer.phase === 'focus' ? `${copy.phase.focus} · ${copy.ofSet((timer.cycle % every) + 1, every)}` : copy.phase[timer.phase]
  return [
    { header },
    timer.paused
      ? { id: 'resume', label: copy.resume, onSelect: () => void pomodoro('resume') }
      : { id: 'pause', label: copy.pause, onSelect: () => void pomodoro('pause') },
    { id: 'skip', label: copy.skip, onSelect: () => void pomodoro('skip') },
    { id: 'restart', label: copy.restart, onSelect: () => void pomodoro('start') },
    { separator: true },
    { id: 'stop', label: copy.stop, onSelect: () => void pomodoro('stop') }
  ]
}

/** The share of the phase behind, as a thin ring. */
function Ring({ done }: { done: number }): JSX.Element {
  const r = 6
  const length = 2 * Math.PI * r
  const shown = Math.min(1, Math.max(0, done))
  return (
    <svg className="pomodoro-ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="pomodoro-ring-track" cx="8" cy="8" r={r} />
      <circle
        className="pomodoro-ring-done"
        cx="8"
        cy="8"
        r={r}
        strokeDasharray={length}
        strokeDashoffset={length * (1 - shown)}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}

/** The time, again on every turn of the second while the phase runs. */
function useSecond(running: boolean, endsAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!running || endsAt === null) return
    // On the turn of the second of the end time, so that the clock turns over as the phase does.
    const wait = (): number => {
      const rest = (endsAt - Date.now()) % 1000
      return (rest > 0 ? rest : 1000) + 5
    }
    let timer = setTimeout(function tick() {
      setNow(Date.now())
      timer = setTimeout(tick, wait())
    }, wait())
    return () => clearTimeout(timer)
  }, [running, endsAt])
  return now
}

const OBSTACLES = '.ui-toasts > .ui-toast, .focus-indicators > *'

function relative(rect: DOMRect, origin: DOMRect): Box {
  return { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top }
}

/**
 * Where the widget goes, looked at again whenever Herman moves, speaks or goes, a toast comes or
 * leaves, focus mode changes, or anything is resized. Null until it has been measured once.
 */
function useCorner(ref: RefObject<HTMLDivElement | null>, asking: boolean): CornerPlace | null {
  const [place, setPlace] = useState<CornerPlace | null>(null)
  const toasts = useToasts((state) => state.toasts.length)
  const focus = useUi((state) => state.focusMode)

  useLayoutEffect(() => {
    const widget = ref.current
    const content = widget?.parentElement
    if (!widget || !content) return
    let frame = 0
    let dock: HTMLElement | null = null
    const resize = new ResizeObserver(() => soon())
    const watchDock = new MutationObserver(() => soon())

    const measure = (): void => {
      frame = 0
      const found = content.querySelector<HTMLElement>(':scope > .herman-dock')
      if (found !== dock) {
        if (dock) resize.unobserve(dock)
        watchDock.disconnect()
        dock = found
        if (dock) {
          resize.observe(dock)
          watchDock.observe(dock, { attributes: true, attributeFilter: ['class'] })
        }
      }
      // His place at rest (offsets leave out the step he takes aside, and his being dragged). In
      // focus mode he is not drawn at all (no box): the corner is the widget's.
      const herman: Box | null =
        dock && dock.classList.contains('is-bottom-right') && dock.offsetWidth > 0 && dock.offsetHeight > 0
          ? {
              left: dock.offsetLeft,
              top: dock.offsetTop,
              right: dock.offsetLeft + dock.offsetWidth,
              bottom: dock.offsetTop + dock.offsetHeight
            }
          : null
      const origin = content.getBoundingClientRect()
      const obstacles = [...document.querySelectorAll(OBSTACLES)]
        .map((element) => relative(element.getBoundingClientRect(), origin))
        .filter((box) => box.right > box.left && box.bottom > box.top)
      const next = placeWidget({
        width: content.clientWidth,
        height: content.clientHeight,
        widget: { width: widget.offsetWidth, height: widget.offsetHeight },
        herman,
        obstacles
      })
      setPlace((previous) => (previous && previous.right === next.right && previous.bottom === next.bottom ? previous : next))
    }
    const soon = (): void => {
      frame ||= requestAnimationFrame(measure)
    }

    resize.observe(content)
    resize.observe(widget)
    // Herman comes and goes (he is turned on or off) as a child of the content.
    const children = new MutationObserver(soon)
    children.observe(content, { childList: true })
    window.addEventListener('resize', soon)
    measure()
    // A toast slides in: look again once it has arrived.
    const settled = setTimeout(soon, 400)
    return () => {
      clearTimeout(settled)
      cancelAnimationFrame(frame)
      resize.disconnect()
      watchDock.disconnect()
      children.disconnect()
      window.removeEventListener('resize', soon)
    }
  }, [ref, asking, toasts, focus])

  return place
}
