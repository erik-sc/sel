// Failures the user is told about, and the words they are told in. Small and always loaded:
// the editor, the database actions and the window's global handlers go through here.
import { homeLocale, type HomeLocale } from '@/home/copy'
import { createThrottle } from '@/ui/throttle'
import { notifyError } from '@/ui/toast'
import { FAILURE_COPY, type FailureCopy } from './copy'

// The system's language until the window says where its language setting lives (main.tsx hands
// over the home's): this module stays free of the stores, so anything can import it.
let currentLocale = (): HomeLocale => homeLocale(null, typeof navigator === 'undefined' ? undefined : navigator.language)

/** Where the words' language comes from from now on. */
export function followLocale(source: () => HomeLocale): void {
  currentLocale = source
}

/** The words in this window's language right now. */
export function failureCopy(): FailureCopy {
  return FAILURE_COPY[currentLocale()]
}

/** At most one write-failure toast per this many milliseconds, across the whole window. */
export const WRITE_FAILURE_NOTICE_MS = 5000
const writeFailureNotice = createThrottle(WRITE_FAILURE_NOTICE_MS)

/**
 * A write was refused and the store already put the blocks back as they are stored: say so,
 * at most once per `WRITE_FAILURE_NOTICE_MS` (a failing disk fails every keystroke). Returns
 * whether the toast was shown.
 */
export function notifyWriteFailed(error: unknown, what: 'change' | 'undo' | 'redo' = 'change', now = Date.now()): boolean {
  const copy = failureCopy()
  const message = what === 'undo' ? copy.undoFailed : what === 'redo' ? copy.redoFailed : copy.changeUndone
  if (writeFailureNotice(now)) {
    notifyError(message, error)
    return true
  }
  console.error(message, error)
  return false
}
