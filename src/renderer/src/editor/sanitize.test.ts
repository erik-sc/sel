import { describe, expect, it } from 'vitest'
import { MAX_URL_LENGTH, coverStyle, cssImage, imageExtension, isSafeImageUrl, isUrl, sanitizeHref, sanitizeLink } from './sanitize'

describe('sanitizeHref', () => {
  it('allows http, https and mailto', () => {
    expect(sanitizeHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c')
    expect(sanitizeHref(' http://example.com ')).toBe('http://example.com')
    expect(sanitizeHref('HTTPS://Example.com')).toBe('HTTPS://Example.com')
    expect(sanitizeHref('mailto:me@example.com')).toBe('mailto:me@example.com')
    expect(sanitizeHref("https://en.wikipedia.org/wiki/Schrödinger's_cat")).toBe("https://en.wikipedia.org/wiki/Schrödinger's_cat")
    expect(sanitizeHref('http://localhost:3000/x')).toBe('http://localhost:3000/x')
  })

  it('adds https to bare domains', () => {
    expect(sanitizeHref('example.com/path')).toBe('https://example.com/path')
    expect(sanitizeHref('sub.example.com:8080')).toBe('https://sub.example.com:8080')
    expect(sanitizeHref('not a url')).toBeNull()
    expect(sanitizeHref('word')).toBeNull()
  })

  it('rejects empty and non-string input', () => {
    expect(sanitizeHref('')).toBeNull()
    expect(sanitizeHref('   ')).toBeNull()
    expect(sanitizeHref(undefined)).toBeNull()
    expect(sanitizeHref(null)).toBeNull()
    expect(sanitizeHref(42 as unknown as string)).toBeNull()
    expect(sanitizeHref({ toString: () => 'javascript:alert(1)' } as unknown as string)).toBeNull()
  })

  it.each([
    ['plain', 'javascript:alert(1)'],
    ['mixed case', 'JaVaScRiPt:alert(1)'],
    ['leading whitespace', '  javascript:alert(1)'],
    ['leading tab', '\tjavascript:alert(1)'],
    ['leading control character', '\u0001javascript:alert(1)'],
    ['leading NUL', '\u0000javascript:alert(1)'],
    ['embedded newline', 'java\nscript:alert(1)'],
    ['embedded tab', 'java\tscript:alert(1)'],
    ['embedded carriage return', 'java\rscript:alert(1)'],
    ['embedded NUL', 'java\u0000script:alert(1)'],
    ['zero-width space', 'java\u200bscript:alert(1)'],
    ['byte order mark', '\ufeffjavascript:alert(1)'],
    ['html entity', '&#106;avascript:alert(1)'],
    ['hex entity', '&#x6A;avascript:alert(1)'],
    ['named entity colon', 'javascript&colon;alert(1)'],
    ['percent-encoded colon', 'javascript%3Aalert(1)'],
    ['double slash', 'javascript://example.com/%0Aalert(1)'],
    ['disguised as a domain', 'javascript:alert(1)//example.com'],
    ['nested in a scheme', 'https:javascript:alert(1)']
  ])('rejects javascript: (%s)', (_name, url) => {
    expect(sanitizeHref(url)).toBeNull()
  })

  it.each([
    ['data html', 'data:text/html,<script>alert(1)</script>'],
    ['data html base64', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['file', 'file:///etc/passwd'],
    ['file windows', 'file://C:/Windows/System32/calc.exe'],
    ['UNC path', '\\\\evil.example\\share\\x.exe'],
    ['blob', 'blob:https://example.com/1234'],
    ['app protocol', 'sel-file://files/a.png'],
    ['custom protocol', 'ms-msdt:/id PCWDiagnostic'],
    ['smb', 'smb://evil.example/share'],
    ['ftp', 'ftp://example.com/x'],
    ['protocol-relative', '//evil.example/x'],
    ['single slash scheme', 'https:/evil.example'],
    ['no slashes', 'https:evil.example'],
    ['backslashes for slashes', 'https:\\\\evil.example'],
    ['backslash before @', 'https://good.example\\@evil.example'],
    ['credentials before the host', 'https://good.example@evil.example'],
    ['credentials with password', 'https://user:pass@evil.example'],
    ['no host', 'https://'],
    ['only a path', 'https:///'],
    ['invalid port', 'https://example.com:99999999'],
    ['space inside', 'https://example.com/a b'],
    ['non-breaking space', 'https://example.com/a\u00a0b'],
    ['right-to-left override', 'https://example.com/\u202egnp.exe'],
    ['double quote', 'https://example.com/"onmouseover="alert(1)'],
    ['angle brackets', 'https://example.com/<script>'],
    ['backtick', 'https://example.com/`x`'],
    ['empty mailto', 'mailto:'],
    ['mailto with slashes', 'mailto://evil.example']
  ])('rejects %s', (_name, url) => {
    expect(sanitizeHref(url)).toBeNull()
  })

  it('rejects over-long urls', () => {
    expect(sanitizeHref(`https://example.com/${'a'.repeat(MAX_URL_LENGTH)}`)).toBeNull()
  })

  it('is idempotent', () => {
    for (const url of ['example.com', 'https://example.com/a?b=1', 'mailto:me@example.com']) {
      const once = sanitizeHref(url)
      expect(once).not.toBeNull()
      expect(sanitizeHref(once)).toBe(once)
    }
  })
})

describe('sanitizeLink', () => {
  const page = 'sel://page/6f1c0a4e-1111-4222-8333-444455556666'

  it('takes a link to a page as it is, and everything sanitizeHref takes', () => {
    expect(sanitizeLink(page)).toBe(page)
    expect(sanitizeLink(` ${page}#b-1 `)).toBe(`${page}#b-1`)
    expect(sanitizeLink('example.com')).toBe('https://example.com')
    expect(sanitizeLink('mailto:a@example.com')).toBe('mailto:a@example.com')
  })

  it('refuses any other sel:// address and what sanitizeHref refuses', () => {
    for (const url of ['sel://settings', 'sel://page/', `${page}?x=1`, 'javascript:alert(1)', null, undefined, '']) {
      expect(sanitizeLink(url)).toBeNull()
    }
  })

  it('leaves sanitizeHref (bookmarks, the system) without page links', () => {
    expect(sanitizeHref(page)).toBeNull()
  })
})

describe('isUrl', () => {
  it('matches a lone http(s) url', () => {
    expect(isUrl('https://example.com')).toBe(true)
    expect(isUrl(' http://example.com/x ')).toBe(true)
    expect(isUrl('see https://example.com')).toBe(false)
    expect(isUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('isSafeImageUrl', () => {
  it('allows stored files and remote http(s) images', () => {
    expect(isSafeImageUrl('sel-file://files/0b9d7c1e-5a55-4d0e-9b3f-2f1c6f0a7e11.png')).toBe(true)
    expect(isSafeImageUrl('https://example.com/a.png?w=100')).toBe(true)
    expect(isSafeImageUrl('http://example.com/a.png')).toBe(true)
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['javascript', 'javascript:alert(1)'],
    ['data html', 'data:text/html,<script>alert(1)</script>'],
    ['data svg', 'data:image/svg+xml,<svg onload=alert(1)>'],
    ['file', 'file:///etc/passwd'],
    ['vbscript', 'vbscript:msgbox(1)'],
    ['protocol-relative', '//evil.example/a.png'],
    ['backslashes', 'https:\\\\evil.example\\a.png'],
    ['credentials', 'https://good.example@evil.example/a.png'],
    ['app file outside the files host', 'sel-file://abc.png'],
    ['app file traversal', 'sel-file://files/../../secret.png'],
    ['app file encoded traversal', 'sel-file://files/%2e%2e%2fsecret.png'],
    ['app file sub-path', 'sel-file://files/a/b.png'],
    ['app file other host', 'sel-file://evil/a.png'],
    ['app file with query', 'sel-file://files/a.png?x=1'],
    ['app file without extension', 'sel-file://files/abc'],
    ['whitespace', 'https://example.com/a b.png'],
    ['newline', 'https://example.com/a\n.png'],
    ['quote', 'https://example.com/a".png']
  ])('rejects %s', (_name, url) => {
    expect(isSafeImageUrl(url)).toBe(false)
  })
})

describe('cssImage / coverStyle', () => {
  it('wraps a safe url in a quoted url() token', () => {
    expect(cssImage('https://example.com/a.png')).toBe('url("https://example.com/a.png")')
    expect(cssImage('sel-file://files/abc.png')).toBe('url("sel-file://files/abc.png")')
  })

  it('does not double-encode percent escapes', () => {
    expect(cssImage('https://example.com/my%20cover.png')).toBe('url("https://example.com/my%20cover.png")')
  })

  it('escapes anything that could end the string or the function', () => {
    expect(cssImage("https://example.com/a').png")).toBe('url("https://example.com/a%27%29.png")')
    expect(cssImage('https://example.com/a(1).png')).toBe('url("https://example.com/a%281%29.png")')
  })

  it.each([
    ['closing the url() and adding a declaration', 'https://example.com/a.png"); background: url("https://evil.example/t'],
    ['closing the url() with a backslash escape', 'https://example.com/a.png\\"); color: red'],
    ['a newline ending the string', 'https://example.com/a.png\n); color: red'],
    ['a css expression', 'expression(alert(1))'],
    ['a javascript url', 'javascript:alert(1)'],
    ['a raw url() value', 'url(https://evil.example/track.png)'],
    ['an image-set', 'image-set("https://evil.example/a.png" 1x)'],
    ['a second layer', 'var(--c-blue-bg), url(https://evil.example/track.png)'],
    ['a gradient with a literal colour', 'linear-gradient(135deg, red, blue)'],
    ['a gradient hiding a url', 'linear-gradient(135deg, var(--c-blue), url(https://evil.example/x))'],
    ['a token with a fallback', 'var(--c-blue, url(https://evil.example/x))'],
    ['a declaration break-out', 'var(--c-blue-bg); position: fixed; inset: 0'],
    ['a comment break-out', 'var(--c-blue-bg)/**/;background:url(//evil.example)']
  ])('coverStyle rejects %s', (_name, cover) => {
    expect(coverStyle(cover)).toBeNull()
  })

  it('never throws on malformed unicode (a lone surrogate used to crash the render)', () => {
    expect(() => coverStyle('https://example.com/\ud800.png')).not.toThrow()
    expect(() => cssImage('\ud800')).not.toThrow()
  })

  it('accepts token covers and safe images', () => {
    expect(coverStyle('var(--c-blue-bg)')).toEqual({ background: 'var(--c-blue-bg)' })
    expect(coverStyle('linear-gradient(135deg, var(--c-blue), var(--c-purple))')).toEqual({
      background: 'linear-gradient(135deg, var(--c-blue), var(--c-purple))'
    })
    expect(coverStyle('https://example.com/c.jpg')).toEqual({ backgroundImage: 'url("https://example.com/c.jpg")' })
    expect(coverStyle(undefined)).toBeNull()
    expect(coverStyle('')).toBeNull()
    expect(coverStyle(42 as unknown as string)).toBeNull()
  })
})

describe('imageExtension', () => {
  it('prefers the mime type and falls back to the file name', () => {
    expect(imageExtension('photo.jfif', 'image/jpeg')).toBe('jpg')
    expect(imageExtension('image.png', 'image/png')).toBe('png')
    expect(imageExtension('', 'IMAGE/WEBP')).toBe('webp')
    expect(imageExtension('scan.JPEG', '')).toBe('jpeg')
    expect(imageExtension('anim.gif', 'application/octet-stream')).toBe('gif')
  })

  it('refuses anything that is not a stored raster format', () => {
    expect(imageExtension('vector.svg', 'image/svg+xml')).toBeNull()
    expect(imageExtension('page.html', 'text/html')).toBeNull()
    expect(imageExtension('run.exe', '')).toBeNull()
    expect(imageExtension('png', '')).toBeNull()
    expect(imageExtension('x.png.exe', 'application/x-msdownload')).toBeNull()
  })
})
