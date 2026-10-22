// "Até amanhã": Herman 64 on his hill under tonight's sky, at the end of Close the day. The hill is
// one still picture (scripts/sky64, 240 × 136, shown at 2×); the moon is drawn here in its real
// phase, in the slot the picture leaves for it; Herman wears the user's outfit and sleeps.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { Hemisphere } from '@shared/sky'
import { moonLitPath, moonPhase } from '@shared/sky/moon'
import { Herman64 } from '@/herman/Herman64'
import './sky.css'

const URLS = import.meta.glob<string>('./sprites/hill-*.png', { eager: true, query: '?url', import: 'default' })
/** Where the hill leaves room for the moon, in the picture's own pixels. */
const MOON = { x: 214, y: 22, r: 9 }

export function RestHill({ day }: { day: string }): JSX.Element {
  const [hemisphere, setHemisphere] = useState<Hemisphere>('south')
  useEffect(() => {
    let alive = true
    window.api.sky.view().then(
      (view) => {
        if (alive && view.hemisphere) setHemisphere(view.hemisphere)
      },
      () => undefined
    )
    return () => {
      alive = false
    }
  }, [])
  const phase = moonPhase(day)
  return (
    <div className="rest-hill" aria-hidden="true">
      <img className="rest-hill-scene is-light" src={URLS['./sprites/hill-light.png']} alt="" width={480} height={272} />
      <img className="rest-hill-scene is-dark" src={URLS['./sprites/hill-dark.png']} alt="" width={480} height={272} />
      <svg className="rest-hill-moon" viewBox="0 0 240 136" shape-rendering="crispEdges">
        <circle className="rest-hill-moon-disc" cx={MOON.x} cy={MOON.y} r={MOON.r} />
        <path className="rest-hill-moon-lit" d={moonLitPath(MOON.x, MOON.y, MOON.r, phase, hemisphere)} />
      </svg>
      <div className="rest-hill-herman">
        <Herman64 pose="sleeping" />
      </div>
    </div>
  )
}
