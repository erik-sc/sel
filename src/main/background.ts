/**
 * The colour a window is created with, so the frame the OS shows before the
 * renderer has painted already matches the page (no white flash). It mirrors
 * `--wall-base`, the flat colour behind the wallpaper: the defaults from the
 * renderer's styles/tokens.css, or the user's override stored in the
 * `appearance` setting. Free of Electron imports so it can be unit-tested.
 */

export const APPEARANCE_KEY = 'appearance'
const TOKEN = '--wall-base'
const DEFAULTS = { light: '#eef1f8', dark: '#0b0c14' } as const

/** `#rgb` / `#rrggbb`, or `rgb(r, g, b)` with plain 0-255 integers. Anything else falls back to the default. */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB_RE = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i

function opaqueColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (HEX_RE.test(text)) return text
  const rgb = RGB_RE.exec(text)
  if (!rgb) return null
  const channels = rgb.slice(1).map(Number)
  if (channels.some((c) => c > 255)) return null
  return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('')
}

/**
 * @param appearance the stored `appearance` setting (untrusted: it is whatever was last saved)
 * @param dark whether the window is about to render the dark theme
 */
export function windowBackground(appearance: unknown, dark: boolean): string {
  const theme = dark ? 'dark' : 'light'
  if (appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
    const overrides: unknown = (appearance as Record<string, unknown>)[theme]
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides) && Object.hasOwn(overrides, TOKEN)) {
      const color = opaqueColor((overrides as Record<string, unknown>)[TOKEN])
      if (color) return color
    }
  }
  return DEFAULTS[theme]
}
