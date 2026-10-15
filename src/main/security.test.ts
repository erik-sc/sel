import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir() },
  dialog: {},
  protocol: {}
}))

import { fitBounds } from './bounds'
import { ftsQuery, likePattern } from './db/repository'
import { openTestRepository } from './db/testing'
import { resolveFileUrl, serveFile, sniffImage, storeImage } from './files'
import { isAllowedRequest, isAppUrl, resolveDevUrl, toExternalUrl } from './security'
import * as arg from './validate'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

describe('toExternalUrl', () => {
  it('accepts http, https and plain mailto links, normalized', () => {
    expect(toExternalUrl('https://example.com/a b')).toBe('https://example.com/a%20b')
    expect(toExternalUrl('http://example.com')).toBe('http://example.com/')
    expect(toExternalUrl('mailto:a@example.com?subject=Hi')).toBe('mailto:a@example.com?subject=Hi')
  })

  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'file://server/share/x.exe',
    'smb://server/share',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x',
    'vscode://file/x',
    'sel://page/abc',
    'C:\\Windows\\System32\\calc.exe',
    '\\\\server\\share\\x.exe',
    '/etc/passwd',
    'example.com',
    '',
    'https://example.com/\n',
    'https://user:pass@example.com/',
    'https://example.com@evil.test/',
    'mailto:a@example.com?attach=C:\\secret.txt',
    'mailto:',
    `https://example.com/${'a'.repeat(3000)}`
  ])('rejects %j', (url) => {
    expect(toExternalUrl(url)).toBeNull()
  })

  it('rejects non-strings', () => {
    for (const value of [null, undefined, 1, {}, ['https://example.com'], new URL('https://example.com')]) {
      expect(toExternalUrl(value)).toBeNull()
    }
  })
})

describe('resolveDevUrl / isAppUrl', () => {
  it('honours the dev server only in unpackaged builds and only on loopback http', () => {
    expect(resolveDevUrl('http://localhost:5173', false)).toBe('http://localhost:5173/')
    expect(resolveDevUrl('http://127.0.0.1:5173/', false)).toBe('http://127.0.0.1:5173/')
    expect(resolveDevUrl('http://localhost:5173', true)).toBeUndefined()
    expect(resolveDevUrl('https://evil.test', false)).toBeUndefined()
    expect(resolveDevUrl('http://evil.test:5173', false)).toBeUndefined()
    expect(resolveDevUrl('http://localhost.evil.test', false)).toBeUndefined()
    expect(resolveDevUrl('http://user@localhost:5173', false)).toBeUndefined()
    expect(resolveDevUrl('file:///x/index.html', false)).toBeUndefined()
    expect(resolveDevUrl('not a url', false)).toBeUndefined()
    expect(resolveDevUrl(undefined, false)).toBeUndefined()
  })

  it('recognizes only the bundled renderer file in production', () => {
    const file = join(tmpdir(), 'sel-app', 'renderer', 'index.html')
    const url = pathToFileURL(file).toString()
    expect(isAppUrl(url, undefined, file)).toBe(true)
    expect(isAppUrl(`${url}?page=abc#x`, undefined, file)).toBe(true)
    expect(isAppUrl(pathToFileURL(join(tmpdir(), 'sel-app', 'renderer', 'other.html')).toString(), undefined, file)).toBe(false)
    expect(isAppUrl(pathToFileURL(join(tmpdir(), 'sel-app', 'renderer', 'x', '..', 'index.html')).toString(), undefined, file)).toBe(true)
    expect(isAppUrl('https://example.com/index.html', undefined, file)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', undefined, file)).toBe(false)
    expect(isAppUrl('about:blank', undefined, file)).toBe(false)
    expect(isAppUrl('data:text/html,x', undefined, file)).toBe(false)
    expect(isAppUrl('garbage', undefined, file)).toBe(false)
  })

  it('recognizes only the dev origin in development', () => {
    const dev = 'http://localhost:5173/'
    expect(isAppUrl('http://localhost:5173/?page=a', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', dev)).toBe(false)
    expect(isAppUrl('http://localhost.evil.test:5173/', dev)).toBe(false)
    expect(isAppUrl('file:///C:/x/index.html', dev)).toBe(false)
  })
})

describe('isAllowedRequest', () => {
  it('lets remote https images through and nothing else on the network', () => {
    expect(isAllowedRequest('https://example.com/a.png', 'image', undefined)).toBe(true)
    expect(isAllowedRequest('http://example.com/a.png', 'image', undefined)).toBe(false)
    for (const type of ['xhr', 'script', 'stylesheet', 'font', 'media', 'subFrame', 'mainFrame', 'ping', 'webSocket', 'other']) {
      expect(isAllowedRequest('https://example.com/x', type, undefined)).toBe(false)
    }
    expect(isAllowedRequest('wss://example.com/', 'webSocket', undefined)).toBe(false)
    expect(isAllowedRequest('http://localhost:5173/src/main.tsx', 'script', undefined)).toBe(false)
    expect(isAllowedRequest('not a url', 'image', undefined)).toBe(false)
  })

  it('leaves local schemes to the CSP and allows the dev server only when one is configured', () => {
    expect(isAllowedRequest('file:///C:/app/index.html', 'mainFrame', undefined)).toBe(true)
    expect(isAllowedRequest('sel-file://files/a.png', 'image', undefined)).toBe(true)
    expect(isAllowedRequest('data:image/png;base64,AAAA', 'image', undefined)).toBe(true)
    const dev = 'http://localhost:5173/'
    expect(isAllowedRequest('http://localhost:5173/src/main.tsx', 'script', dev)).toBe(true)
    expect(isAllowedRequest('ws://localhost:5173/', 'webSocket', dev)).toBe(true)
    expect(isAllowedRequest('http://localhost:9999/', 'xhr', dev)).toBe(false)
    expect(isAllowedRequest('https://example.com/x.js', 'script', dev)).toBe(false)
  })
})

describe('sel-file protocol', () => {
  let dir: string
  let outside: string
  let stored: string

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'sel-files-'))
    dir = join(root, 'files')
    outside = join(root, 'secret.png')
    await mkdir(dir)
    await writeFile(outside, PNG)
    await writeFile(join(root, 'sel.db'), 'db')
    stored = await storeImage(PNG, dir)
    await writeFile(join(dir, 'page.html'), '<script>1</script>')
    await writeFile(join(dir, 'vector.svg'), '<svg onload="1"/>')
    await mkdir(join(dir, 'sub.png'))
  })
  afterAll(async () => {
    await rm(join(dir, '..'), { recursive: true, force: true })
  })

  it('stores images under a generated name with the sniffed extension', () => {
    expect(stored).toMatch(/^sel-file:\/\/files\/[0-9a-f-]{36}\.png$/)
  })

  it('rejects data that is not an accepted image, whatever it claims to be', async () => {
    const enc = new TextEncoder()
    await expect(storeImage(enc.encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), dir)).rejects.toThrow()
    await expect(storeImage(enc.encode('<!doctype html><script>alert(1)</script>'), dir)).rejects.toThrow()
    await expect(storeImage(enc.encode('MZ' + '\u0090'.repeat(40)), dir)).rejects.toThrow()
    await expect(storeImage(enc.encode('BM this is not a bitmap at all'), dir)).rejects.toThrow()
    await expect(storeImage(new Uint8Array(0), dir)).rejects.toThrow()
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpg')
    expect(sniffImage(enc.encode('GIF89a......'))).toBe('gif')
    expect(sniffImage(enc.encode('RIFF....WEBPVP8 '))).toBe('webp')
    expect(sniffImage(enc.encode('....ftypavif....'))).toBe('avif')
  })

  it.each([
    'sel-file://files/../sel.db',
    'sel-file://files/..%2Fsel.db',
    'sel-file://files/%2e%2e%2fsecret.png',
    'sel-file://files/..%5Csecret.png',
    'sel-file://files/sub/a.png',
    'sel-file://files/%00.png',
    'sel-file://files/a.png%00.html',
    'sel-file://files/C:%5CWindows%5Cwin.ini',
    'sel-file://files/',
    'sel-file://files/.',
    'sel-file://files/..',
    'sel-file://files/.png',
    'sel-file://files/page.html',
    'sel-file://files/vector.svg',
    'sel-file://files/a.png.exe',
    'sel-file://other/a.png',
    'sel-file://user@files/a.png',
    'sel-file://files:81/a.png',
    'file:///etc/passwd',
    'https://files/a.png',
    'not a url'
  ])('does not resolve %j', async (url) => {
    expect(resolveFileUrl(url, dir)).toBeNull()
    expect((await serveFile({ method: 'GET', url }, dir)).status).toBe(404)
  })

  it('keeps every resolved path inside the directory', () => {
    const full = resolveFileUrl('sel-file://files/abc-123_X.png?x=1#y', dir)
    expect(full).toBe(join(dir, 'abc-123_X.png'))
    // Dot segments are collapsed by the URL parser and can never climb above the host root.
    expect(resolveFileUrl('sel-file://files/a/../../secret.png', dir)).toBe(join(dir, 'secret.png'))
  })

  it('serves a stored image with a fixed content type and nosniff', async () => {
    const res = await serveFile({ method: 'GET', url: stored }, dir)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
  })

  it('answers GET only, and never lists or serves a directory', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
      const res = await serveFile({ method, url: stored }, dir)
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('GET')
    }
    expect((await serveFile({ method: 'GET', url: 'sel-file://files/sub.png' }, dir)).status).toBe(404)
    expect((await serveFile({ method: 'GET', url: 'sel-file://files/missing.png' }, dir)).status).toBe(404)
  })

  it('refuses a symlink that points out of the directory', async (ctx) => {
    try {
      await symlink(outside, join(dir, 'link.png'), 'file')
    } catch {
      // Creating symlinks needs a privilege this machine does not grant.
      return ctx.skip()
    }
    expect(resolveFileUrl('sel-file://files/link.png', dir)).not.toBeNull()
    expect((await serveFile({ method: 'GET', url: 'sel-file://files/link.png' }, dir)).status).toBe(404)
  })
})

describe('FTS query escaping', () => {
  it('quotes every term so operators are plain text', () => {
    expect(ftsQuery('hello world')).toBe('"hello"* "world"*')
    expect(ftsQuery('a AND b OR NOT c')).toBe('"a"* "AND"* "b"* "OR"* "NOT"* "c"*')
    expect(ftsQuery('NEAR(a b, 2)')).toBe('"NEAR"* "a"* "b"* "2"*')
    expect(ftsQuery('text:secret ^start "quoted" (x) -y +z *')).toBe('"text"* "secret"* "start"* "quoted"* "x"* "y"* "z"*')
    expect(ftsQuery('"" " \' ; -- */ {} []')).toBeNull()
    expect(ftsQuery('')).toBeNull()
  })

  it('escapes LIKE wildcards', () => {
    expect(likePattern('100%_\\')).toBe('%100\\%\\_\\\\%')
  })

  it('never throws and never matches more than asked, whatever the input', () => {
    const repo = openTestRepository()
    const page = repo.create({ type: 'page', parentId: null, props: { title: [['Budget 100% done_now']] } })
    repo.create({ type: 'text', parentId: page.id, props: { title: [['alpha beta']] } })
    repo.create({ type: 'text', parentId: page.id, props: { title: [['gamma']] } })
    const hostile = [
      '"',
      '""',
      '"unbalanced',
      '*',
      'a*b"c',
      'AND',
      'OR OR',
      'NOT',
      'NEAR(',
      'NEAR(alpha beta',
      'text:',
      'id:alpha',
      '{text id}:alpha',
      '^',
      '(',
      ')',
      'alpha) OR (gamma',
      "'; DROP TABLE blocks; --",
      '%',
      '_',
      '\\',
      '\u0000',
      'a'.repeat(5000)
    ]
    for (const query of hostile) expect(() => repo.search(query)).not.toThrow()
    // Operators are literal: this is not "alpha OR gamma".
    expect(repo.search('alpha OR gamma')).toEqual([])
    expect(repo.search('alpha) OR (gamma')).toEqual([])
    // A column filter is not a way to search the unindexed id column.
    expect(repo.search(`id:${page.id.slice(0, 8)}`)).toEqual([])
    // Wildcards are literal in the substring fallback.
    expect(repo.search('%')).toHaveLength(1)
    expect(repo.search('_')).toHaveLength(1)
    expect(repo.listTrash()).toEqual([])
    expect(repo.get(page.id)).not.toBeNull()
    repo.close()
  })
})

describe('ipc argument validation', () => {
  it('validates ids', () => {
    expect(arg.id('abc-DEF_123')).toBe('abc-DEF_123')
    for (const bad of ['', 'a/b', '../x', 'a b', 'a'.repeat(65), 1, null, undefined, {}, ['a']]) {
      expect(() => arg.id(bad)).toThrow('Invalid id')
    }
    expect(arg.nullableId(null)).toBeNull()
    expect(arg.nullableId(undefined)).toBeNull()
    expect(arg.afterId(undefined)).toBeUndefined()
    expect(arg.afterId(null)).toBeNull()
    expect(() => arg.afterId('../x')).toThrow()
    expect(arg.optionalId(undefined)).toBeUndefined()
    expect(() => arg.optionalId('a b')).toThrow()
    expect(() => arg.idList(['ok', 'not ok'], 'ids')).toThrow()
    expect(() => arg.idList('abc', 'ids')).toThrow()
  })

  it('accepts only plain objects', () => {
    expect(arg.plainObject({ a: 1 }, 'x')).toEqual({ a: 1 })
    expect(arg.plainObject(Object.create(null), 'x')).toEqual({})
    for (const bad of [null, undefined, 'x', 1, [], new Map(), new Date(), new (class Foo {})()]) {
      expect(() => arg.plainObject(bad, 'input')).toThrow('Invalid input')
    }
  })

  it('caps list lengths, strings and serialized size', () => {
    expect(() => arg.list(new Array(arg.LIMITS.batch + 1).fill('a'), 'ids')).toThrow('Too many ids')
    expect(arg.list(new Array(arg.LIMITS.batch).fill('a'), 'ids')).toHaveLength(arg.LIMITS.batch)
    expect(() => arg.text('x'.repeat(11), 'query', 10)).toThrow()
    expect(() => arg.text(5, 'query', 10)).toThrow()
    expect(() => arg.limit('5')).toThrow()
    expect(() => arg.limit(Number.NaN)).toThrow()
    expect(() => arg.limit(Number.POSITIVE_INFINITY)).toThrow()
    expect(arg.limit(undefined)).toBeUndefined()
    expect(() => arg.sized('x'.repeat(100), 'value', 50)).toThrow('too large')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => arg.sized(cyclic, 'value', 50)).toThrow('Invalid value')
    expect(() => arg.sized({ n: 1n }, 'value', 50)).toThrow('Invalid value')
  })

  it('validates op batches', () => {
    expect(arg.ops([{ op: 'delete', id: 'a' }])).toHaveLength(1)
    expect(() => arg.ops('nope')).toThrow()
    expect(() => arg.ops([null])).toThrow('Invalid op')
    expect(() => arg.ops([[]])).toThrow('Invalid op')
    expect(() => arg.ops(new Array(arg.LIMITS.batch + 1).fill({ op: 'delete', id: 'a' }))).toThrow('Too many ops')
    const big = { op: 'update', id: 'a', patch: { props: { title: [['x'.repeat(arg.LIMITS.batchChars / 4)]] } } }
    expect(() => arg.ops([big, big, big, big, big])).toThrow('too large')
  })

  it('validates client ids', () => {
    expect(arg.clientId('3f0c9d0e-5a53-4c56-9d0a-0d6d5d3f3a11')).toBeTruthy()
    for (const bad of ['', 'a b', '<script>', 'a'.repeat(65), 1, null, undefined]) {
      expect(() => arg.clientId(bad)).toThrow('Invalid client id')
    }
  })

  it('lets the renderer write only its own settings', () => {
    for (const key of ['theme', 'appearance', 'shell.tabs', 'shell.sidebar', 'shell.expanded', 'shell.wordCount','database.activeView.abc-123', 'editor.x', 'ui.y']) {
      expect(arg.writableSettingKey(key)).toBe(key)
    }
    for (const key of ['rootOrder', 'seeded', 'windowBounds', 'shell', 'other.key', 'themes', 'appearancex']) {
      expect(() => arg.writableSettingKey(key)).toThrow('read-only')
      expect(arg.settingKey(key)).toBe(key)
    }
    for (const key of ['', '.', 'shell.', '.shell', 'shell..x', 'shell x', 'shell/x', '__proto__', '1x', 'a'.repeat(129), 5, null, {}]) {
      expect(() => arg.settingKey(key)).toThrow()
      expect(() => arg.writableSettingKey(key)).toThrow()
    }
  })

  it('lets the renderer turn other apps in and out, as a boolean, and nothing else of mcp', () => {
    expect(arg.writableSettingKey('mcp.enabled')).toBe('mcp.enabled')
    for (const key of ['mcp', 'mcp.token', 'mcp.enabled.x']) expect(() => arg.writableSettingKey(key)).toThrow('read-only')
    expect(arg.settingValueFor('mcp.enabled', true)).toBe(true)
    expect(arg.settingValueFor('mcp.enabled', null)).toBeNull()
    for (const bad of ['yes', 1, {}]) expect(() => arg.settingValueFor('mcp.enabled', bad)).toThrow('Invalid setting value')
  })

  it('accepts exactly the four history settings, typed and clamped', () => {
    for (const key of ['history.enabled', 'history.sessionMinutes', 'history.maxPerPage', 'history.budgetMb']) {
      expect(arg.writableSettingKey(key)).toBe(key)
    }
    for (const key of ['history', 'history.other', 'history.enabled.x', 'historyx.enabled']) {
      expect(() => arg.writableSettingKey(key)).toThrow('read-only')
    }
    expect(arg.settingValueFor('history.enabled', false)).toBe(false)
    expect(arg.settingValueFor('history.enabled', null)).toBeNull()
    expect(arg.settingValueFor('history.sessionMinutes', 15.4)).toBe(15)
    expect(arg.settingValueFor('history.sessionMinutes', 0)).toBe(1)
    expect(arg.settingValueFor('history.maxPerPage', 1e9)).toBe(5000)
    expect(arg.settingValueFor('history.budgetMb', 1)).toBe(10)
    for (const [key, bad] of [
      ['history.enabled', 'yes'],
      ['history.enabled', 1],
      ['history.sessionMinutes', '10'],
      ['history.maxPerPage', Number.NaN],
      ['history.budgetMb', { mb: 5 }]
    ] as const) {
      expect(() => arg.settingValueFor(key, bad)).toThrow('Invalid setting value')
    }
    // Other keys keep the generic rule.
    expect(arg.settingValueFor('shell.tabs', { a: 1 })).toEqual({ a: 1 })
  })

  it('checks version names and restore modes', () => {
    expect(arg.versionLabel(undefined)).toBeNull()
    expect(arg.versionLabel(null)).toBeNull()
    expect(arg.versionLabel('Draft')).toBe('Draft')
    expect(() => arg.versionLabel('x'.repeat(121))).toThrow('Invalid version name')
    expect(() => arg.versionLabel(5)).toThrow('Invalid version name')
    expect(arg.restoreMode('replace')).toBe('replace')
    expect(arg.restoreMode('copy')).toBe('copy')
    for (const bad of ['merge', '', null, undefined, 1]) expect(() => arg.restoreMode(bad)).toThrow('Invalid restore mode')
  })

  it('caps setting values', () => {
    expect(arg.settingValue(undefined)).toBeNull()
    expect(arg.settingValue({ a: 1 })).toEqual({ a: 1 })
    expect(() => arg.settingValue('x'.repeat(arg.LIMITS.settingChars + 1))).toThrow('too large')
  })

  it('does not leak paths, SQL or stacks through errors', () => {
    const fsError = Object.assign(new Error("ENOENT: no such file or directory, open 'C:\\Users\\me\\AppData\\x.db'"), {
      code: 'ENOENT'
    })
    const sqlError = Object.assign(new Error('near "SELEC": syntax error'), { code: 'SQLITE_ERROR' })
    for (const err of [fsError, sqlError, 'a string', null, undefined, { message: 'C:\\secret' }, new Error('')]) {
      expect(toMessage(err)).toBe('Something went wrong')
      expect(arg.isUnexpectedError(err)).toBe(true)
    }
    const domain = arg.toIpcError(new Error('Block not found: abc'))
    expect(domain.message).toBe('Block not found: abc')
    expect(arg.isUnexpectedError(new Error('Invalid id'))).toBe(false)
    expect(Object.keys(arg.toIpcError(Object.assign(new Error('x'), { path: 'C:\\secret' })))).toEqual([])
    expect(arg.toIpcError(new Error('x'.repeat(5000))).message).toHaveLength(arg.LIMITS.errorMessage)
  })
})

function toMessage(err: unknown): string {
  return arg.toIpcError(err).message
}

describe('fitBounds', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1040 }]

  it('keeps a visible window where it was', () => {
    expect(fitBounds({ x: 100, y: 50, width: 1000, height: 700, maximized: true }, displays)).toEqual({
      x: 100,
      y: 50,
      width: 1000,
      height: 700,
      maximized: true
    })
  })

  it('drops the position when the window would be off every display', () => {
    const out = fitBounds({ x: 5000, y: 5000, width: 1000, height: 700 }, displays)
    expect(out).toEqual({ width: 1000, height: 700, maximized: false })
    expect(fitBounds({ x: -990, y: 0, width: 1000, height: 700 }, displays).x).toBeUndefined()
  })

  it('clamps the size to the displays and the minimum', () => {
    expect(fitBounds({ x: 0, y: 0, width: 1e9, height: 1e9 }, displays)).toMatchObject({ width: 1920, height: 1040 })
    expect(fitBounds({ x: 0, y: 0, width: 1, height: -5 }, displays)).toMatchObject({ width: 480, height: 360 })
  })

  it('ignores anything that is not four finite numbers', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { x: 0, y: 0, width: '800', height: 600 }, { x: 0, y: 0, width: Number.NaN, height: 600 }, { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 600 }]) {
      expect(fitBounds(bad, displays)).toEqual({})
    }
  })
})
