/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PRESETS } from './presets'
import { cleanValue, parseNumeric } from './sanitize'
import { GROUPS, TOKENS, TOKEN_MAP } from './schema'
import { SKINS, isSkin } from './skins'

function parseBlock(css: string, selector: RegExp): Map<string, string> {
  const block = selector.exec(css)
  if (!block) throw new Error(`block not found: ${selector}`)
  const out = new Map<string, string>()
  for (const match of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (out.has(match[1])) throw new Error(`duplicate declaration of ${match[1]}`)
    out.set(match[1], match[2].trim())
  }
  return out
}

const css = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)
const light = parseBlock(css, /:root\s*\{([^}]*)\}/)
const dark = parseBlock(css, /:root\[data-theme='dark'\]\s*\{([^}]*)\}/)

describe('appearance schema matches tokens.css', () => {
  it('finds the tokens in the stylesheet', () => {
    expect(light.size).toBeGreaterThan(100)
    expect(dark.size).toBeGreaterThan(40)
  })

  it('lists every token exactly once, with none extra', () => {
    const names = TOKENS.map((token) => token.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...light.keys()].filter((name) => !TOKEN_MAP[name])).toEqual([])
    expect(names.filter((name) => !light.has(name))).toEqual([])
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([])
  })

  it('has the same light defaults', () => {
    for (const token of TOKENS) expect(`${token.name}: ${token.light}`).toBe(`${token.name}: ${light.get(token.name)}`)
  })

  it('marks exactly the tokens with a dark override as themed, with the same dark defaults', () => {
    for (const token of TOKENS) {
      expect(`${token.name} themed: ${token.themed}`).toBe(`${token.name} themed: ${dark.has(token.name)}`)
      expect(`${token.name}: ${token.dark}`).toBe(`${token.name}: ${dark.get(token.name)}`)
    }
  })

  it('gives every token a known group, a label and a default its own control accepts', () => {
    for (const token of TOKENS) {
      expect(GROUPS).toContain(token.group)
      expect(token.label.length).toBeGreaterThan(0)
      expect(cleanValue(token, token.light)).toBe(token.light)
      if (token.dark !== undefined) expect(cleanValue(token, token.dark)).toBe(token.dark)
      if (token.min !== undefined) {
        const n = parseNumeric(token, token.light)
        expect(n).not.toBeNull()
        expect(n!).toBeGreaterThanOrEqual(token.min)
        expect(n!).toBeLessThanOrEqual(token.max!)
      }
    }
    for (const group of GROUPS) expect(TOKENS.some((token) => token.group === group)).toBe(true)
  })
})

describe('presets', () => {
  it('has unique ids and starts with the empty default', () => {
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length)
    expect(PRESETS.length).toBeGreaterThanOrEqual(6)
    const first = PRESETS[0]
    expect(first.id).toBe('zen')
    expect({ ...first.light, ...first.dark, ...first.shared }).toEqual({})
  })

  it('keeps every look designed over the original Glass defaults independent of the Zen defaults', () => {
    // Glass restores each token Zen changed. A preset that predates Zen and misses one of them
    // would silently pick up the Zen value there.
    const glass = PRESETS.find((preset) => preset.id === 'glass')!
    expect(Object.keys(glass.light).length).toBeGreaterThan(40)
    expect(Object.keys(glass.dark).length).toBeGreaterThan(40)
    expect(Object.keys(glass.shared).length).toBeGreaterThan(10)
    for (const preset of PRESETS) {
      if (preset.id === 'zen' || preset.id === 'zen-ink') continue
      for (const bucket of ['light', 'dark', 'shared'] as const) {
        const missing = Object.keys(glass[bucket]).filter((name) => !Object.hasOwn(preset[bucket], name))
        expect(missing, `${preset.id}: ${bucket}`).toEqual([])
      }
    }
  })

  it('only overrides known tokens, in the right set, with valid values', () => {
    for (const preset of PRESETS) {
      for (const bucket of ['light', 'dark', 'shared'] as const) {
        for (const [name, value] of Object.entries(preset[bucket])) {
          const token = TOKEN_MAP[name]
          expect(token, `${preset.id}: ${name}`).toBeDefined()
          expect(token.themed, `${preset.id}: ${name} in ${bucket}`).toBe(bucket !== 'shared')
          expect(cleanValue(token, value), `${preset.id}: ${name}`).toBe(value)
        }
      }
    }
  })

  it('names only window styles the app ships, and uses each of them', () => {
    const used = new Set<string>()
    for (const preset of PRESETS) {
      if (preset.skin === undefined) continue
      expect(isSkin(preset.skin), preset.id).toBe(true)
      used.add(preset.skin)
    }
    expect([...used].sort()).toEqual(SKINS.map((skin) => skin.id).sort())
  })
})

/** The selectors of the top-level rules of a stylesheet (nested rules are not looked at). */
function topLevelPreludes(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) out.push(text.slice(start, i).trim())
      depth += 1
    } else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) start = i + 1
    }
  }
  return out
}

describe('window styles', () => {
  const read = (name: string) =>
    readFileSync(fileURLToPath(new URL(`./skins/${name}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('loads one stylesheet per window style', () => {
    const imports = [...read('index.css').matchAll(/@import '\.\/([\w-]+)\.css';/g)].map((match) => match[1])
    expect(imports.sort()).toEqual(SKINS.map((skin) => skin.id).sort())
  })

  it('scopes every rule to its own window style and only sets its own custom properties', () => {
    for (const { id } of SKINS) {
      const sheet = read(`${id}.css`)
      for (const prelude of topLevelPreludes(sheet)) {
        for (const selector of prelude.split(',').map((part) => part.trim())) {
          const scoped =
            selector.startsWith(`:root[data-skin='${id}']`) ||
            selector.startsWith(`.ap-preset-thumb[data-skin='${id}']`) ||
            selector === `@keyframes sk-${id}-throb`
          expect(scoped, `${id}: ${selector}`).toBe(true)
        }
      }
      // Tokens belong to the theme; a skin that set them would hide them from the editor.
      const declared = [...sheet.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map((match) => match[1])
      expect(declared.filter((name) => !name.startsWith('--sk-')), id).toEqual([])
    }
  })
})
