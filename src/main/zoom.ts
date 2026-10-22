// The window's zoom (Ctrl+Plus, Ctrl+Minus, Ctrl+0), remembered on this device: set again on
// every window as its page loads. Chromium zooms by origin, so every window of the app shares
// one level, and one setting is enough. The setting is written by main alone and never synced:
// the zoom that suits one screen does not suit another.
import type { BrowserWindow, WebContents } from 'electron'

/** The settings key: a zoom factor, 1 at 100%. Local to the device, like `windowBounds`. */
export const ZOOM_KEY = 'windowZoom'

/** The factors Ctrl+Plus and Ctrl+Minus step through, Chromium's own between 50% and 300%. */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/** A stored zoom read back: a factor within the steps' range, or 1 for anything else. */
export function cleanZoom(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  const min = ZOOM_STEPS[0]
  const max = ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return value < min || value > max ? 1 : value
}

/** The next factor up (1) or down (-1) from `factor`; 0 is back to 100%. */
export function nextZoom(factor: number, direction: -1 | 0 | 1): number {
  if (direction === 0) return 1
  // From a factor between two steps (set some other way), the step on the side asked for.
  if (direction > 0) return ZOOM_STEPS.find((step) => step > factor + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((step) => step < factor - 0.001) ?? ZOOM_STEPS[0]
}

interface ZoomStore {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
}

let store: ZoomStore | null = null

/** Where the zoom is read from and kept (the settings table); set once at start-up. */
export function keepZoomIn(next: ZoomStore): void {
  store = next
}

function save(factor: number): void {
  try {
    store?.setSetting(ZOOM_KEY, factor)
  } catch {
    /* losing the zoom is not worth surfacing */
  }
}

/** Puts the remembered zoom on a window, now and on every load (a reload resets it). */
export function restoreZoom(win: BrowserWindow): void {
  const apply = (contents: WebContents): void => contents.setZoomFactor(cleanZoom(store?.getSetting(ZOOM_KEY)))
  win.webContents.on('dom-ready', () => apply(win.webContents))
}

/** Ctrl+Plus (1), Ctrl+Minus (-1) and Ctrl+0 (0), from the menu. */
export function zoomWindow(win: BrowserWindow | null | undefined, direction: -1 | 0 | 1): void {
  if (!win || win.isDestroyed()) return
  const factor = nextZoom(win.webContents.getZoomFactor(), direction)
  win.webContents.setZoomFactor(factor)
  save(factor)
}
