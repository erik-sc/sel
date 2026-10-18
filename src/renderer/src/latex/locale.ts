import { create } from 'zustand'
import { LATEX_SHELL_COPY, latexLocale, type LatexLocale, type LatexShellCopy } from './copy'

/**
 * Which language LaTeX documents and equation blocks speak in this window: the system's at first,
 * then the AI language setting once read, and again whenever the window comes back to the front.
 * It is also the language of a new document's skeleton and the paper size of its PDF.
 */
const localeStore = create<{ locale: LatexLocale }>(() => ({ locale: latexLocale(null, navigator.language) }))

function refresh(): void {
  window.api.app
    .getSetting<unknown>('ai.language')
    .then((language) => {
      const locale = latexLocale(language, navigator.language)
      if (localeStore.getState().locale !== locale) localeStore.setState({ locale })
    })
    .catch(() => undefined)
}

let watching = false
function watch(): void {
  if (watching) return
  watching = true
  refresh()
  window.addEventListener('focus', refresh)
}

export function currentLatexLocale(): LatexLocale {
  watch()
  return localeStore.getState().locale
}

/** The shell's words now (for menus and commands, built when they open). */
export function latexShellCopy(): LatexShellCopy {
  return LATEX_SHELL_COPY[currentLatexLocale()]
}

/** The language, for a component that redraws when it changes. */
export function useLatexLocale(): LatexLocale {
  watch()
  return localeStore((state) => state.locale)
}
