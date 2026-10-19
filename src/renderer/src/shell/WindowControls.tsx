import { useEffect, useState } from 'react'
import { IS_MAC } from '@/ui/platform'

/** How long after the last resize event the maximized state is read again. */
const RESIZE_SETTLE_MS = 80

/** Minimize / maximize / close for the frameless window (not rendered on macOS). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const isMac = IS_MAC

  useEffect(() => {
    if (isMac) return
    let alive = true
    const sync = (): void => {
      window.api.app.window
        .isMaximized()
        .then((value) => {
          if (alive) setMaximized(value)
        })
        .catch(() => undefined)
    }
    sync()
    // Resizing fires many events; one question to the main process once it settles is enough.
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = (): void => {
      clearTimeout(timer)
      timer = setTimeout(sync, RESIZE_SETTLE_MS)
    }
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      alive = false
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [isMac])

  if (isMac) return null

  const icon = { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1 }

  return (
    <div className="window-controls">
      <button type="button" aria-label="Minimize" tabIndex={-1} onClick={() => window.api.app.window.minimize()}>
        <svg {...icon} aria-hidden="true">
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        tabIndex={-1}
        onClick={() => window.api.app.window.toggleMaximize()}
      >
        <svg {...icon} aria-hidden="true">
          {maximized ? <path d="M2.5 2.5v-2h7v7h-2M.5 2.5h7v7h-7z" /> : <path d="M.5.5h9v9h-9z" />}
        </svg>
      </button>
      <button type="button" className="is-close" aria-label="Close" tabIndex={-1} onClick={() => window.api.app.window.close()}>
        <svg {...icon} aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </button>
    </div>
  )
}
