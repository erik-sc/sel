// Herman 64: Herman as a low-poly figure from a 1997 memory card. Each pose is a strip of pre-rendered
// frames (sprites.ts) that CSS steps through; the size comes from --herman-size, a whole multiple of
// the 84px frame so the pixels stay square. He wears the skin chosen in Settings → Herman.
// Nothing moves while the window is hidden or not in front, nor with reduced motion.
import { useEffect, useState } from 'react'
import type { CSSProperties, JSX } from 'react'
import { wornSkin } from '@shared/herman'
import type { FigurePose } from './Figure'
import { useHerman } from './gate'
import { spriteUrl, TIMING, type HermanAnimation } from './sprites'
import './herman.css'
import './herman64.css'

/** What each of his poses plays. */
export const POSE_ANIMATION: Record<FigurePose, HermanAnimation> = {
  resting: 'idle',
  listening: 'wave',
  thinking: 'think',
  speaking: 'talk',
  pleased: 'cheer',
  sleeping: 'sleep',
  concerned: 'spin'
}

export interface Herman64Props {
  pose: FigurePose
  /** Rises into view once when he first appears, then plays his pose. */
  draw?: boolean
  /** Plays his pose. Off for a figure that is only an illustration: he stands still. */
  alive?: boolean
  className?: string
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const attentive = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()

/** True while the window is visible and in front. */
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

export function Herman64({ pose, draw = false, alive = true, className }: Herman64Props): JSX.Element {
  const skin = useHerman((state) => wornSkin(state.skin, state.seasonal))
  const front = useAttentive()
  // With reduced motion there is no entrance: it would never end, and its first frame is empty.
  const [entering, setEntering] = useState(() => draw && !reducedMotion())
  const animation: HermanAnimation = entering ? 'enter' : POSE_ANIMATION[pose]
  const { frames, fps } = TIMING[animation]
  const style = {
    '--frames': frames,
    backgroundImage: `url("${spriteUrl(skin, animation)}")`,
    animationDuration: `${(frames / fps).toFixed(2)}s`
  } as CSSProperties

  const classes = ['herman64', `is-${animation}`]
  if (alive && front) classes.push('is-playing')
  if (entering) classes.push('is-once')
  if (className) classes.push(className)
  return (
    <span
      className={classes.join(' ')}
      style={style}
      role="img"
      aria-hidden="true"
      onAnimationEnd={entering ? () => setEntering(false) : undefined}
    />
  )
}
