// Every look stays legible: text, secondary and tertiary text reach 4.5:1 on every surface they
// are drawn on, and the focus ring 3:1, in every preset, light and dark (WCAG 1.4.3 and 1.4.11).
import { describe, expect, it } from 'vitest'
import { composite, contrastRatio, luminance, parseColor, type Rgba } from './color'
import { PRESETS, type Preset } from './presets'
import { TOKEN_MAP, defaultValue, type ThemeName } from './schema'

const TEXT = ['--text', '--text-secondary', '--text-tertiary'] as const
/** Inks that carry meaning in text (a late date, a done mark), held to the text bar too. */
const INKS = ['--danger', '--success'] as const
const TAGS = ['orange', 'red', 'blue'] as const
const NEEDS: Record<string, number> = { '--text': 4.5, '--text-secondary': 4.5, '--text-tertiary': 4.5, '--focus-ring': 3 }

/** Preset, theme and token that may stay below the bar, written down here and nowhere else. None today. */
const EXCEPTIONS: ReadonlySet<string> = new Set<string>()

/** Zen is the default: tokens.css as it is, with no preset over it. */
const DEFAULT: Preset = { id: 'default', name: 'Default', description: '', light: {}, dark: {}, shared: {} }

function color(preset: Preset, theme: ThemeName, name: string): Rgba {
  const token = TOKEN_MAP[name]
  const value = (token.themed ? preset[theme][name] : preset.shared[name]) ?? defaultValue(token, theme)
  const parsed = parseColor(value)
  if (!parsed) throw new Error(`${preset.id} ${theme}: ${name} is not a colour the test can read (${value})`)
  return parsed
}

/**
 * The surfaces text is drawn on, each composited over what is under it: the page and the sidebar
 * over the wallpaper (its base and each of its colours, the worst counts), a raised surface and a
 * popover over the page.
 */
function surfaces(preset: Preset, theme: ThemeName): Rgba[] {
  const opaque = (c: Rgba): Rgba => ({ ...c, a: 1 })
  const wallpaper = ['--wall-base', '--wall-1', '--wall-2', '--wall-3', '--wall-4'].map((n) => opaque(color(preset, theme, n)))
  const over = (name: string, under: Rgba[]): Rgba[] => under.map((u) => composite(color(preset, theme, name), u))
  const page = over('--bg', wallpaper)
  return [
    ...page,
    ...over('--bg-elevated', page),
    ...over('--bg-solid', wallpaper),
    ...over('--glass-thick-bg', page),
    ...over('--bg-sidebar', wallpaper)
  ]
}

describe('contrastRatio', () => {
  const c = (text: string): Rgba => parseColor(text) as Rgba
  it('measures as WCAG does', () => {
    expect(contrastRatio(c('#000000'), c('#ffffff'))).toBeCloseTo(21, 5)
    expect(contrastRatio(c('#ffffff'), c('#ffffff'))).toBe(1)
    // The usual reference: #767676 is the lightest grey that passes on white.
    expect(contrastRatio(c('#767676'), c('#ffffff'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(c('#777777'), c('#ffffff'))).toBeLessThan(4.5)
    expect(contrastRatio(c('#ffffff'), c('#000000'))).toBeCloseTo(contrastRatio(c('#000000'), c('#ffffff')), 10)
  })

  it('paints a translucent colour over the background first', () => {
    expect(contrastRatio(c('rgba(0, 0, 0, 0)'), c('#ffffff'))).toBe(1)
    expect(contrastRatio(c('rgba(0, 0, 0, 0.5)'), c('#ffffff'))).toBeCloseTo(contrastRatio(c('#808080'), c('#ffffff')), 1)
    expect(luminance(composite(c('rgba(255, 255, 255, 0.5)'), c('#000000')))).toBeCloseTo(luminance(c('#808080')), 2)
  })
})

describe('every preset, light and dark', () => {
  for (const preset of [DEFAULT, ...PRESETS]) {
    for (const theme of ['light', 'dark'] as ThemeName[]) {
      it(`${preset.id}, ${theme}`, () => {
        const grounds = surfaces(preset, theme)
        for (const name of [...TEXT, '--focus-ring']) {
          if (EXCEPTIONS.has(`${preset.id} ${theme} ${name}`)) continue
          const fg = color(preset, theme, name)
          const worst = Math.min(...grounds.map((g) => contrastRatio(fg, g)))
          expect(worst, `${name} on its worst surface`).toBeGreaterThanOrEqual(NEEDS[name])
        }
      })
    }
  }

  it('lists only exceptions that are still needed', () => {
    for (const key of EXCEPTIONS) {
      const [id, theme, name] = key.split(' ')
      const preset = PRESETS.find((p) => p.id === id) as Preset
      expect(preset, key).toBeDefined()
      const worst = Math.min(...surfaces(preset, theme as ThemeName).map((g) => contrastRatio(color(preset, theme as ThemeName, name), g)))
      expect(worst, key).toBeLessThan(NEEDS[name])
    }
  })
})

/**
 * The layers of the Contraste board, as the app paints them over the page (`--bg`, or `--bg-elevated` for a card
 * and a menu): the sheet, a sunk block, the current row, a selected row, a card under the pointer, the active
 * menu row. Each is an opaque colour, so ink and tags can be measured on it.
 */
function layers(theme: ThemeName): Record<string, Rgba> {
  const p = DEFAULT
  const bg = composite(color(p, theme, '--bg'), { r: 0, g: 0, b: 0, a: 1 })
  const elevated = composite(color(p, theme, '--bg-elevated'), bg)
  return {
    sheet: bg,
    sunk: composite(color(p, theme, '--bg-sunk'), bg),
    'current row': composite(color(p, theme, '--bg-active'), bg),
    'selected row': composite(color(p, theme, '--accent-soft'), bg),
    'card under the pointer': composite(color(p, theme, '--bg-hover'), elevated),
    'active menu row': composite(color(p, theme, '--bg-menu-active'), elevated)
  }
}

describe('the ink where text actually lands (default look)', () => {
  for (const theme of ['light', 'dark'] as ThemeName[]) {
    it(`${theme}: text, danger and success reach 4.5:1 on every layer`, () => {
      for (const [layer, ground] of Object.entries(layers(theme))) {
        for (const name of [...TEXT, ...INKS]) {
          expect(contrastRatio(color(DEFAULT, theme, name), ground), `${name} on ${layer}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${theme}: control outlines reach 3:1 on every layer`, () => {
      for (const [layer, ground] of Object.entries(layers(theme))) {
        expect(contrastRatio(color(DEFAULT, theme, '--border-control'), ground), `--border-control on ${layer}`).toBeGreaterThanOrEqual(3)
      }
    })

    it(`${theme}: a tag's text reaches 4.5:1 on its own fill, over every layer`, () => {
      for (const [layer, ground] of Object.entries(layers(theme))) {
        for (const tag of TAGS) {
          const fill = composite(color(DEFAULT, theme, `--c-${tag}-bg`), ground)
          expect(contrastRatio(color(DEFAULT, theme, `--c-${tag}`), fill), `${tag} tag on ${layer}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it(`${theme}: disabled text stays quieter than tertiary text`, () => {
      const sheet = layers(theme).sheet
      expect(contrastRatio(color(DEFAULT, theme, '--text-disabled'), sheet)).toBeLessThan(
        contrastRatio(color(DEFAULT, theme, '--text-tertiary'), sheet)
      )
    })
  }
})
