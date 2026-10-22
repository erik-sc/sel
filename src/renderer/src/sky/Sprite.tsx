// The Sky's pixel sprites (scripts/sky64/generate.mjs renders them into ./sprites): a strip of 84px
// frames, one for the light theme and one for the dark, played with CSS steps(). Shown at 2×.
import type { CSSProperties, JSX } from 'react'
import type { SkyEvent } from '@shared/sky/events'

const URLS = import.meta.glob<string>('./sprites/*.png', { eager: true, query: '?url', import: 'default' })
const url = (name: string): string => URLS[`./sprites/${name}.png`] ?? ''

export const FIGURE_FRAMES = 16
export const RARE_FRAMES = 12

/** The rare night each event of the Sky shows, if it has one. */
export function rareOf(event: SkyEvent | null | undefined, echo: boolean): string | null {
  if (echo) return 'echo'
  switch (event?.kind) {
    case 'eclipse':
    case 'meteors':
    case 'comet':
    case 'season':
    case 'new-year':
      return event.kind
    case 'anniversary':
      return 'first-star'
    default:
      return null
  }
}

/** Rare nights that play once and keep their last frame (the moon ends copper; the year's wheel ends lit). */
const ONCE = new Set(['rare-eclipse', 'rare-new-year'])

export function SkySprite({ name, frames, fps = 8, label }: { name: string; frames: number; fps?: number; label?: string }): JSX.Element {
  const once = ONCE.has(name)
  const style = (theme: 'light' | 'dark'): CSSProperties =>
    ({
      '--frames': frames,
      backgroundImage: `url("${url(`${name}-${theme}`)}")`,
      animationDuration: `${(frames / fps).toFixed(2)}s`
    }) as CSSProperties
  return (
    <span
      className={once ? 'sky-sprite is-once' : 'sky-sprite'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="sky-sprite-frame is-light" style={style('light')} />
      <span className="sky-sprite-frame is-dark" style={style('dark')} />
    </span>
  )
}
