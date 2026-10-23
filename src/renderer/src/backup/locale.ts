import { create } from 'zustand'
import { DATA_COPY, dataLocale, type DataCopy, type DataLocale } from '@shared/dataCopy'

/**
 * Which language the rows of backups and export speak in this window: the system's at first,
 * then the AI language setting once read, and again whenever the window comes back to the front
 * (the same rule as the archive, see archive/locale.ts).
 */
const useDataLocale = create<{ locale: DataLocale }>(() => ({ locale: dataLocale(null, navigator.language) }))

function refresh(): void {
  window.api.app
    .getSetting<unknown>('ai.language')
    .then((language) => {
      const locale = dataLocale(language, navigator.language)
      if (useDataLocale.getState().locale !== locale) useDataLocale.setState({ locale })
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

/** The words and the language, for a component that redraws when the language changes. */
export function useDataCopy(): { copy: DataCopy; locale: DataLocale } {
  watch()
  const locale = useDataLocale((state) => state.locale)
  return { copy: DATA_COPY[locale], locale }
}

/** The language now, for words read outside a component (a command's title in the palette). */
export function dataLocaleNow(): DataLocale {
  watch()
  return useDataLocale.getState().locale
}
