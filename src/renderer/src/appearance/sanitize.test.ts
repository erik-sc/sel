import { describe, expect, it } from 'vitest'
import { formatColor, parseColor, toHex } from './color'
import {
  MAX_CUSTOM_CSS_LENGTH,
  buildCss,
  cleanValue,
  effectiveValueIn,
  emptyAppearance,
  formatNumeric,
  parseNumeric,
  sanitizeAppearance,
  sanitizeCustomCss
} from './sanitize'
import { TOKENS, TOKEN_MAP } from './schema'

const t = (name: string) => TOKEN_MAP[name]

describe('colour parsing and formatting', () => {
  it('parses hex in every length', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#007AFF')).toEqual({ r: 0, g: 122, b: 255, a: 1 })
    expect(parseColor('#0008')).toEqual({ r: 0, g: 0, b: 0, a: 0.533 })
    expect(parseColor('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 0.502 })
    expect(parseColor('#12')).toBeNull()
    expect(parseColor('#12345')).toBeNull()
  })

  it('parses rgb, rgba and hsl in comma and space syntax', () => {
    expect(parseColor('rgba(255, 255, 255, 0.62)')).toEqual({ r: 255, g: 255, b: 255, a: 0.62 })
    expect(parseColor('rgb(0 122 255 / 50%)')).toEqual({ r: 0, g: 122, b: 255, a: 0.5 })
    expect(parseColor('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('hsla(120deg 100% 25% / 0.5)')).toEqual({ r: 0, g: 128, b: 0, a: 0.5 })
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('rgb(1, 2)')).toBeNull()
    expect(parseColor('rgb(a, b, c)')).toBeNull()
    expect(parseColor('papayawhip')).toBeNull()
  })

  it('formats opaque colours as hex and translucent ones as rgba', () => {
    expect(formatColor({ r: 0, g: 122, b: 255, a: 1 })).toBe('#007aff')
    expect(formatColor({ r: 0, g: 122, b: 255, a: 0.5 })).toBe('rgba(0, 122, 255, 0.5)')
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0 })).toBe('rgba(0, 0, 0, 0)')
    expect(toHex({ r: 255, g: 59, b: 48, a: 0.2 })).toBe('#ff3b30')
  })

  it('round-trips every colour default in the schema', () => {
    for (const token of TOKENS) {
      if (token.kind !== 'color') continue
      for (const value of [token.light, token.dark!]) {
        const parsed = parseColor(value)
        expect(parsed, `${token.name}: ${value}`).not.toBeNull()
        expect(formatColor(parsed!)).toBe(value)
      }
    }
  })
})

describe('numeric values', () => {
  it('reads and writes plain numbers with the token unit', () => {
    expect(parseNumeric(t('--glass-blur'), '28px')).toBe(28)
    expect(parseNumeric(t('--glass-blur'), '28')).toBeNull()
    expect(parseNumeric(t('--glass-blur'), '2em')).toBeNull()
    expect(parseNumeric(t('--tracking-title'), '-0.022em')).toBe(-0.022)
    expect(parseNumeric(t('--weight-bold'), '700')).toBe(700)
    expect(formatNumeric(t('--glass-saturate'), 150)).toBe('150%')
    expect(formatNumeric(t('--duration'), 220)).toBe('220ms')
    expect(formatNumeric(t('--wall-intensity'), 0.1 + 0.2)).toBe('0.3')
  })

  it('exposes the px base of scaled text sizes', () => {
    expect(parseNumeric(t('--text-body'), 'calc(16px * var(--font-scale))')).toBe(16)
    expect(formatNumeric(t('--text-body'), 17)).toBe('calc(17px * var(--font-scale))')
    expect(parseNumeric(t('--text-body'), '16px')).toBeNull()
  })
})

describe('value sanitisation', () => {
  it('strips characters that could end the declaration', () => {
    expect(cleanValue(t('--accent'), ' #ff0000; ')).toBe('#ff0000')
    expect(cleanValue(t('--accent'), '#ff0000}</style>')).toBeNull()
    expect(cleanValue(t('--ease'), 'ease-in;{}')).toBe('ease-in')
  })

  it('rejects values that could swallow what follows', () => {
    expect(cleanValue(t('--ease'), 'cubic-bezier(0.1, 0.2')).toBeNull()
    expect(cleanValue(t('--font-sans'), "'Inter, sans-serif")).toBeNull()
    expect(cleanValue(t('--font-sans'), 'Inter /* x')).toBeNull()
    expect(cleanValue(t('--font-sans'), 'Inter\\')).toBeNull()
    expect(cleanValue(t('--accent'), '')).toBeNull()
    expect(cleanValue(t('--accent'), 42)).toBeNull()
  })

  it('caps the length', () => {
    expect(cleanValue(t('--font-sans'), `Inter${', serif'.repeat(1000)}`)!.length).toBeLessThanOrEqual(2000)
  })

  it('allows url() only for image tokens with a local scheme', () => {
    const image = t('--wall-image')
    expect(cleanValue(image, 'url("selida-file://images/a.png")')).toBe('url("selida-file://images/a.png")')
    expect(cleanValue(image, 'url("data:image/png;base64,AAAA")')).toBe('url("data:image/png;base64,AAAA")')
    expect(cleanValue(image, 'url("selida-file://a.png}</style>")')).toBeNull()
    expect(cleanValue(image, "url('data:image/svg+xml,abc')")).toBe("url('data:image/svg+xml,abc')")
    expect(cleanValue(image, 'none')).toBe('none')
    expect(cleanValue(image, 'url("https://example.com/a.png")')).toBeNull()
    expect(cleanValue(image, 'url(selida-file://a.png)')).toBeNull()
    expect(cleanValue(image, 'url("selida-file://a.png"), url("http://x")')).toBeNull()
    expect(cleanValue(image, 'linear-gradient(red, blue)')).toBeNull()
    expect(cleanValue(t('--accent'), 'url("selida-file://a.png")')).toBeNull()
    expect(cleanValue(t('--shadow-card'), '0 0 0 red, URL (http://x)')).toBeNull()
    expect(cleanValue(t('--font-sans'), 'image-set("http://x" 1x)')).toBeNull()
  })

  it('rejects numbers with the wrong unit and unparsable colours', () => {
    expect(cleanValue(t('--radius-m'), '12px')).toBe('12px')
    expect(cleanValue(t('--radius-m'), '12')).toBeNull()
    expect(cleanValue(t('--radius-m'), 'big')).toBeNull()
    expect(cleanValue(t('--accent'), 'rgb(1, 2)')).toBeNull()
  })
})

describe('custom css sanitisation', () => {
  it('removes @import and closing style tags', () => {
    expect(sanitizeCustomCss('@import url("http://x/a.css");\n.a{color:red}')).toBe('\n.a{color:red}')
    expect(sanitizeCustomCss('@IMPORT "a.css" screen;.a{}')).toBe('.a{}')
    expect(sanitizeCustomCss('.a{}</STYLE><script>')).toBe('.a{}><script>')
    expect(sanitizeCustomCss('@im@import "x";port "y";.a{}')).not.toMatch(/@import/i)
    expect(sanitizeCustomCss('@\\69mport "y";.a{}')).not.toMatch(/@\\/)
    expect(sanitizeCustomCss('@media (min-width: 1px){.a{color:red}}')).toBe('@media (min-width: 1px){.a{color:red}}')
  })

  it('caps the size and tolerates non-strings', () => {
    expect(sanitizeCustomCss('a'.repeat(MAX_CUSTOM_CSS_LENGTH + 10)).length).toBe(MAX_CUSTOM_CSS_LENGTH)
    expect(sanitizeCustomCss(null)).toBe('')
  })
})

describe('state sanitisation', () => {
  it('returns an empty state for junk', () => {
    expect(sanitizeAppearance(null)).toEqual(emptyAppearance())
    expect(sanitizeAppearance('x')).toEqual(emptyAppearance())
    expect(sanitizeAppearance({ light: [1, 2], dark: 3 })).toEqual(emptyAppearance())
  })

  it('drops unknown tokens, misplaced tokens, invalid values and values equal to the default', () => {
    const data = sanitizeAppearance({
      light: {
        '--accent': '#ff0000',
        '--nope': '1',
        __proto__: 'x',
        constructor: 'x',
        '--glass-blur': '10px',
        '--danger': '#ff3b30',
        '--success': 'url(http://x)'
      },
      dark: { '--accent': '#00ff00', '--text': 7 },
      shared: { '--glass-blur': '10px', '--accent': '#000000', '--radius-m': '12px', '--font-scale': '1.1' },
      customCss: '@import "x";.a{}',
      presetId: 'bad id!'
    })
    expect(data).toEqual({
      light: { '--accent': '#ff0000' },
      dark: { '--accent': '#00ff00' },
      shared: { '--glass-blur': '10px', '--font-scale': '1.1' },
      customCss: '.a{}',
      presetId: null
    })
  })

  it('builds one stylesheet with shared and light in :root, dark in its own rule, custom css last', () => {
    const data = sanitizeAppearance({
      light: { '--accent': '#ff0000' },
      dark: { '--accent': '#00ff00' },
      shared: { '--glass-blur': '10px' },
      customCss: '.a{color:red}',
      presetId: 'glass'
    })
    expect(buildCss(data)).toBe(
      ":root{--glass-blur:10px;--accent:#ff0000;}\n:root[data-theme='dark']{--accent:#00ff00;}\n.a{color:red}\n"
    )
    expect(buildCss(emptyAppearance())).toBe('')
    expect(effectiveValueIn(data, '--accent', 'dark')).toBe('#00ff00')
    expect(effectiveValueIn(data, '--glass-blur', 'dark')).toBe('10px')
    expect(effectiveValueIn(data, '--danger', 'dark')).toBe('#ff453a')
    expect(effectiveValueIn(data, '--danger', 'light')).toBe('#ff3b30')
  })
})
