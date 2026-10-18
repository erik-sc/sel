// The sky at the end of Close the day (animation 14): under the dimmed window the year's sky
// appears, the moon rises a little, and the line just written becomes its star (animation 1).
// Only then come the words. Drawn only while the Sky is on.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { SKY_LAST_SEEN_KEY, skyScene, type SkyScene, type SkyView } from '@shared/sky'
import { COPY } from './copy'
import { SkyChart } from './SkyChart'
import { useReducedMotion } from './motion'
import type { SkyPlay } from './timeline'
import './sky.css'

export function RestSky({ day }: { day: string }): JSX.Element | null {
  const [view, setView] = useState<SkyView | null>(null)
  const [scene, setScene] = useState<SkyScene | null>(null)
  const [play, setPlay] = useState<SkyPlay | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    let alive = true
    window.api.sky.view().then(
      (next) => {
        if (!alive || !next.enabled) return
        const sky = skyScene(next, Number(day.slice(0, 4)), day, { events: false })
        const written = sky.months.some((m) => m.stars.some((s) => s.day === day))
        setView(next)
        setScene(sky)
        setPlay({ moonRise: true, stars: written ? [day] : [], delay: 5 })
        // The star has been seen: the Sky does not play it again.
        if (written) window.api.app.setSetting(SKY_LAST_SEEN_KEY, day).catch(() => undefined)
      },
      (error: unknown) => console.error('the sky could not be read for the rest', error)
    )
    return () => {
      alive = false
    }
  }, [day])

  if (!view || !scene) return null
  return (
    <div className="close-rest-sky">
      <SkyChart scene={scene} copy={COPY[view.locale]} locale={view.locale} play={play} playKey="rest" reduced={reduced} small onPlayed={() => setPlay(null)} />
    </div>
  )
}
