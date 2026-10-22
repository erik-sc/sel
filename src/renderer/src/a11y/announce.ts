// One polite live region per window, for what a keyboard move did ("Moved up", "3 blocks
// deleted"): the screen reader says it after what it is already saying, and nothing is shown.
import { useHome } from '@/home/store'
import { A11Y_COPY, type A11yCopy } from './copy'

let region: HTMLElement | null = null
let timer = 0

function liveRegion(): HTMLElement {
  if (region?.isConnected) return region
  region = document.createElement('div')
  region.className = 'sr-only'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  region.setAttribute('aria-atomic', 'true')
  region.dataset.announcer = ''
  document.body.append(region)
  return region
}

/**
 * Says `text` through the live region. The region is emptied first and filled a moment later,
 * so the same words twice in a row ("Moved up", "Moved up") are said twice.
 */
export function announce(text: string): void {
  if (!text || typeof document === 'undefined') return
  const el = liveRegion()
  el.textContent = ''
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    el.textContent = text
  }, 50)
}

/** The words in the language the home is in, read when they are needed. */
export function a11yCopy(): A11yCopy {
  return A11Y_COPY[useHome.getState().locale]
}

export function useA11yCopy(): A11yCopy {
  return A11Y_COPY[useHome((state) => state.locale)]
}
