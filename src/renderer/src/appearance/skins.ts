/**
 * Window styles ("skins"): built-in stylesheets that redraw the chrome (bevels, title bars,
 * buttons, scrollbars) in ways the design tokens cannot express. A skin is switched on by
 * `data-skin` on <html> and lives in skins/<id>.css, scoped to `:root[data-skin='<id>']`.
 *
 * Skins are part of the app, not of the user's data: a saved or imported theme can only name
 * one of the ids below, never carry CSS of its own (that is what custom CSS is for). Colours
 * still come from the tokens, so a skin works with any palette; the presets that introduce a
 * skin pair it with the palette it was drawn for.
 */

export interface Skin {
  id: string
  name: string
}

export const SKINS: Skin[] = [
  { id: 'aero', name: 'Frutiger Aero' },
  { id: 'win98', name: 'Windows 98' },
  { id: 'luna', name: 'Windows XP' },
  { id: 'aqua', name: 'Aqua' },
  { id: 'platinum', name: 'Macintosh' },
  { id: 'liquid', name: 'Full glass' },
  { id: 'terminal', name: 'Terminal' }
]

const SKIN_IDS: ReadonlySet<string> = new Set(SKINS.map((skin) => skin.id))

export function isSkin(value: unknown): value is string {
  return typeof value === 'string' && SKIN_IDS.has(value)
}
