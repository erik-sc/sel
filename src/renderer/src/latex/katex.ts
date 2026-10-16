// KaTeX, fetched the first time a formula is drawn (a LaTeX document opens, or a page shows an
// equation block): its code, stylesheet and fonts are a chunk of their own, never in the first
// bundle. The fonts are files of the app (font-src 'self'), never a CDN.
import { useEffect, useState } from 'react'
import type { MathCache, MathEngine } from './math'

let loading: Promise<MathEngine> | null = null
let loaded: MathEngine | null = null

export function loadMathEngine(): Promise<MathEngine> {
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => {
      loaded = module.default as unknown as MathEngine
      return loaded
    })
    // A failed fetch may be retried by the next formula.
    loading.catch(() => {
      loading = null
    })
  }
  return loading
}

/** The engine when it has already been loaded, so a formula can be drawn without a frame of waiting. */
export function loadedMathEngine(): MathEngine | null {
  return loaded
}

/** Rendered formulas, shared by every document and equation block of this window. */
export const mathCache: MathCache = new Map()

/** The engine for a component: null until it has been loaded (which this starts). */
export function useMathEngine(): MathEngine | null {
  const [engine, setEngine] = useState<MathEngine | null>(loaded)
  useEffect(() => {
    if (engine) return
    let alive = true
    loadMathEngine().then(
      (e) => alive && setEngine(e),
      (error: unknown) => console.error('[latex] KaTeX could not be loaded', error)
    )
    return () => {
      alive = false
    }
  }, [engine])
  return engine
}
