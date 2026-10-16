import { create } from 'zustand'
import { ARCHIVE_COPY, archiveLocale, type ArchiveCopy, type ArchiveLocale } from './copy'

/**
 * Which language the archive speaks in this window. It starts from the system's and is
 * corrected from the AI language setting once that has been read; read again whenever the
 * window comes back to the front, since the setting can change in another window.
 */
const useArchiveLocale = create<{ locale: ArchiveLocale }>(() => ({ locale: archiveLocale(null, navigator.language) }))

export function refreshArchiveLocale(): void {
  window.api.app
    .getSetting<unknown>('ai.language')
    .then((language) => {
      const locale = archiveLocale(language, navigator.language)
      if (useArchiveLocale.getState().locale !== locale) useArchiveLocale.setState({ locale })
    })
    .catch(() => undefined)
}

let watching = false
function watch(): void {
  if (watching) return
  watching = true
  refreshArchiveLocale()
  window.addEventListener('focus', refreshArchiveLocale)
}

/** The archive's words now (for menus and commands, built when they open). */
export function archiveCopy(): ArchiveCopy {
  watch()
  return ARCHIVE_COPY[useArchiveLocale.getState().locale]
}

/** The archive's words, for a component that redraws when the language changes. */
export function useArchiveCopy(): ArchiveCopy {
  watch()
  return ARCHIVE_COPY[useArchiveLocale((state) => state.locale)]
}

export function archiveDateLocale(): ArchiveLocale {
  return useArchiveLocale.getState().locale
}
