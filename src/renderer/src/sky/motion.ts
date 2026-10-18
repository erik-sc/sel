import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** The user asked the system for less motion (Windows: "Show animations" off). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches)
  useEffect(() => {
    const list = window.matchMedia(QUERY)
    const change = (): void => setReduced(list.matches)
    list.addEventListener('change', change)
    return () => list.removeEventListener('change', change)
  }, [])
  return reduced
}
