import { describe, expect, it } from 'vitest'
import type { Block, DatabaseView, PropertySchema } from '../../../../shared/types'
import * as L from '../logic'

describe('safeExternalUrl (what a url cell may open)', () => {
  it.each([
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
    ['HTTP://EXAMPLE.com', 'HTTP://EXAMPLE.com'],
    ['  http://x.y  ', 'http://x.y'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['example.com', 'https://example.com'],
    ['sub.example.com:8080/path', 'https://sub.example.com:8080/path']
  ])('%j -> %j', (input, expected) => {
    expect(L.safeExternalUrl(input)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/System32/calc.exe',
    'vbscript:msgbox(1)',
    'smb://host/share',
    'ms-msdt:/id',
    'selida-file://x.png',
    'blob:https://example.com/1',
    'about:blank',
    '//example.com',
    '/etc/passwd',
    'C:\\Windows\\calc.exe',
    'https://',
    'mailto:',
    'https://exa mple.com',
    'https://example.com/\u0000',
    'not a url',
    'x'.repeat(5000) + '.com',
    ''
  ])('%j is refused', (input) => {
    expect(L.safeExternalUrl(input)).toBeNull()
  })

  it('refuses non-strings', () => {
    for (const v of [null, undefined, 5, {}, ['https://a.b'], true]) expect(L.safeExternalUrl(v)).toBeNull()
  })
})

describe('coverStyle (gallery covers)', () => {
  it('accepts the token colours and gradients the cover picker writes', () => {
    for (const cover of [
      'var(--c-blue-bg)',
      'linear-gradient(135deg, var(--c-blue-bg), var(--c-purple-bg))',
      'linear-gradient(135deg, var(--c-green), var(--c-blue))'
    ]) {
      expect(L.coverStyle(cover)).toEqual({ kind: 'css', background: cover })
    }
  })

  it('accepts local and http(s) images, quoted', () => {
    expect(L.coverStyle('selida-file://abc.png')).toEqual({ kind: 'image', backgroundImage: 'url("selida-file://abc.png")' })
    expect(L.coverStyle('https://example.com/a%20b.png?x=1')).toEqual({
      kind: 'image',
      backgroundImage: 'url("https://example.com/a%20b.png?x=1")'
    })
  })

  it.each([
    'red',
    '#fff',
    'url(https://evil.example/track.png)',
    'url("https://evil.example/x")',
    'var(--c-blue-bg); position: fixed; inset: 0',
    'var(--c-blue-bg) url(https://evil.example/x)',
    'linear-gradient(135deg, var(--c-blue-bg), url(https://evil.example/x))',
    'linear-gradient(red, blue)',
    'image-set("https://evil.example/x" 1x)',
    'expression(alert(1))',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'file:///C:/secret.png',
    'blob:https://example.com/1',
    '/absolute/path.png',
    './relative.png',
    'https://example.com/a\nb.png',
    ''
  ])('%j is refused', (cover) => {
    expect(L.coverStyle(cover)).toBeNull()
  })

  it.each([
    'https://example.com/a.png") , url("https://evil.example/x',
    'https://example.com/a.png"); background: red; x: url("',
    "https://example.com/a.png'); background: red; x: url('",
    'https://example.com/a.png\\"); x: url(\\"',
    'https://example.com/a.png)}body{display:none}',
    'selida-file://a.png") url("https://evil.example'
  ])('a crafted image url cannot break out of url(): %j', (cover) => {
    const style = L.coverStyle(cover)
    // Refusing the value outright is fine too; what must never happen is a break-out.
    if (style === null) return
    expect(style.kind).toBe('image')
    if (style.kind !== 'image') return
    const inner = /^url\("([^"]*)"\)$/.exec(style.backgroundImage)
    // Exactly one url("...") whose content has nothing that could close the string or the function.
    expect(inner).not.toBeNull()
    expect(inner![1]).not.toMatch(/["'()\\\s]/)
  })

  it('encodes rather than drops an http image url with quotes and parentheses', () => {
    expect(L.coverStyle('https://example.com/a (1).png?q="x"')).toEqual({
      kind: 'image',
      backgroundImage: 'url("https://example.com/a%20%281%29.png?q=%22x%22")'
    })
  })

  it('refuses non-strings', () => {
    for (const v of [null, undefined, 5, {}, ['https://a.b/c.png']]) expect(L.coverStyle(v)).toBeNull()
  })
})

describe('numbers', () => {
  it('parses both separator conventions', () => {
    expect(L.parseNumberInput('1.234,56', 'number', 'pt-BR')).toBe(1234.56)
    expect(L.parseNumberInput('1,234.56', 'number', 'pt-BR')).toBe(1234.56)
    expect(L.parseNumberInput('1.234,56', 'number', 'en-US')).toBe(1234.56)
    expect(L.parseNumberInput('R$ 1.234.567,89', 'number', 'pt-BR')).toBe(1234567.89)
    expect(L.parseNumberInput('1.234.567', 'number', 'en-US')).toBe(1234567)
  })

  it('reads a lone separator in the locale of the display', () => {
    expect(L.parseNumberInput('1,5', 'number', 'pt-BR')).toBe(1.5)
    expect(L.parseNumberInput('1,234', 'number', 'pt-BR')).toBe(1.234)
    expect(L.parseNumberInput('1.234', 'number', 'pt-BR')).toBe(1234)
    expect(L.parseNumberInput('1.5', 'number', 'pt-BR')).toBe(1.5)
    expect(L.parseNumberInput('1.234', 'number', 'en-US')).toBe(1.234)
    expect(L.parseNumberInput('1,234', 'number', 'en-US')).toBe(1234)
    expect(L.parseNumberInput('-0,5', 'number', 'pt-BR')).toBe(-0.5)
    expect(L.parseNumberInput('\u22123', 'number', 'en-US')).toBe(-3)
  })

  it('never yields NaN or Infinity', () => {
    for (const text of ['NaN', 'Infinity', '-Infinity', '1e999', '--', '.', ',', 'e5', 'abc', '5-3', '1 of 2', '1.2.3,4,5']) {
      const parsed = L.parseNumberInput(text, 'number', 'en-US')
      expect(parsed === undefined || (typeof parsed === 'number' && Number.isFinite(parsed))).toBe(true)
    }
    expect(L.parseNumberInput('1e999')).toBeUndefined()
    expect(L.parseNumberInput('NaN')).toBeUndefined()
    expect(L.parseNumberInput('5-3')).toBeUndefined()
    expect(L.parseNumberInput('   ')).toBeNull()
    expect(L.parseNumberInput(5 as unknown as string)).toBeUndefined()
  })

  it.each(['en-US', 'pt-BR', 'de-DE', 'fr-FR'])('the editor text of a number parses back to the same number (%s)', (locale) => {
    for (const n of [0, 1, -1, 1.5, 1.234, 1234, 1234.5, 0.1 + 0.2, 1e21, 1e-7, -0.000123, 123456789.123, 999.999]) {
      expect(L.parseNumberInput(L.numberToInput(n, locale), 'number', locale)).toBe(n)
    }
    expect(L.numberToInput(NaN, locale)).toBe('')
    expect(L.numberToInput(Infinity, locale)).toBe('')
  })

  it('formats with the locale and guards non-finite values', () => {
    expect(L.formatNumber(1234.5, 'number', { locale: 'pt-BR' })).toBe('1.234,5')
    expect(L.formatNumber(1234.5, 'number', { locale: 'en-US' })).toBe('1,234.5')
    expect(L.formatNumber(0.5, 'percent', { locale: 'en-US' })).toBe('50%')
    expect(L.formatNumber(NaN)).toBe('')
    expect(L.formatNumber(Infinity)).toBe('')
    expect(L.formatNumber('5' as unknown as number)).toBe('')
    expect(L.formatNumber(5, 'bogus' as never, { locale: 'en-US' })).toBe('5')
    expect(L.formatNumber(5, 'currency', { locale: 'en-US', currency: 'not-a-currency' })).toBe('5')
    expect(L.defaultCurrency('en-toString')).toBe('USD')
  })
})

describe('sanitizeValue (every write goes through it)', () => {
  const select: PropertySchema = { id: 's', name: 'S', type: 'select', options: [{ id: 'a', name: 'A', color: 'red' }] }
  const multi: PropertySchema = { ...select, id: 'm', type: 'multi_select' }
  const p = (type: PropertySchema['type']): PropertySchema => ({ id: 'x', name: 'X', type })

  it('keeps well-typed values', () => {
    expect(L.sanitizeValue(p('text'), 'hi')).toBe('hi')
    expect(L.sanitizeValue(p('number'), 0)).toBe(0)
    expect(L.sanitizeValue(p('checkbox'), true)).toBe(true)
    expect(L.sanitizeValue(select, 'a')).toBe('a')
    expect(L.sanitizeValue(multi, ['a', 'a'])).toEqual(['a'])
    expect(L.sanitizeValue(p('date'), { start: '2024-3-1', end: '2024-03-05' })).toEqual({ start: '2024-03-01', end: '2024-03-05' })
  })

  it('refuses everything else', () => {
    expect(L.sanitizeValue(p('number'), NaN)).toBeNull()
    expect(L.sanitizeValue(p('number'), Infinity)).toBeNull()
    expect(L.sanitizeValue(p('number'), '5')).toBeNull()
    expect(L.sanitizeValue(p('text'), '   ')).toBeNull()
    expect(L.sanitizeValue(p('text'), { a: 1 })).toBeNull()
    expect(L.sanitizeValue(p('text'), 'x'.repeat(L.MAX_TEXT_LENGTH + 50))).toHaveLength(L.MAX_TEXT_LENGTH)
    expect(L.sanitizeValue(p('checkbox'), 'yes')).toBe(false)
    expect(L.sanitizeValue(select, 'ghost')).toBeNull()
    expect(L.sanitizeValue(multi, ['ghost', 5])).toBeNull()
    expect(L.sanitizeValue(p('date'), { start: '2024-02-30' })).toBeNull()
    expect(L.sanitizeValue(p('created_time'), 5)).toBeNull()
    expect(L.sanitizeValue(p('title'), 'x')).toBeNull()
  })
})

describe('names are capped', () => {
  const schema: L.Schema = {
    t: { id: 't', name: 'Name', type: 'title' },
    s: { id: 's', name: 'S', type: 'select', options: [{ id: 'a', name: 'A', color: 'red' }] }
  }
  const long = `  ${'x'.repeat(500)}  `
  const view: DatabaseView = { id: 'v', name: 'V', type: 'table', visibleProperties: ['t'], filters: [], sorts: [] }

  it('for properties, options and views', () => {
    expect(L.cleanName(long)).toHaveLength(L.MAX_NAME_LENGTH)
    expect(L.addProperty(schema, { type: 'text', name: long }).property.name).toHaveLength(L.MAX_NAME_LENGTH)
    expect(L.renameProperty(schema, 's', long).s.name).toHaveLength(L.MAX_NAME_LENGTH)
    expect(L.addOption(schema, 's', long).option?.name).toHaveLength(L.MAX_NAME_LENGTH)
    expect(L.updateOption(schema, 's', 'a', { name: long }).s.options![0].name).toHaveLength(L.MAX_NAME_LENGTH)
    expect(L.renameView([view], 'v', long)[0].name).toHaveLength(L.MAX_NAME_LENGTH)
    expect(L.addView(schema, [view], 'list', long).view.name).toHaveLength(L.MAX_NAME_LENGTH)
    expect(L.duplicateView([{ ...view, name: 'y'.repeat(L.MAX_NAME_LENGTH) }], 'v').view!.name.length).toBeLessThanOrEqual(
      L.MAX_NAME_LENGTH
    )
  })

  it('ids come from the random generator, never from the typed text', () => {
    const typed = '"><img src=x onerror=alert(1)>'
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(L.addProperty(schema, { type: 'text', name: typed }).property.id).toMatch(uuid)
    expect(L.addOption(schema, 's', typed).option!.id).toMatch(uuid)
    expect(L.addView(schema, [view], 'board', typed).view.id).toMatch(uuid)
    expect(L.duplicateView([view], 'v').view!.id).toMatch(uuid)
    expect(L.addProperty(schema, { id: '__proto__', type: 'text' }).property.id).toMatch(uuid)
    const derived = L.changePropertyType({ ...schema, x: { id: 'x', name: 'X', type: 'text' } }, 'x', 'select', [
      { id: 'r', type: 'page', parentId: 'db', content: [], props: { values: { x: typed } }, createdAt: 0, updatedAt: 0, trashedAt: null } as Block
    ])
    expect(derived.schema.x.options![0]).toMatchObject({ name: typed })
    expect(derived.schema.x.options![0].id).toMatch(uuid)
  })
})
