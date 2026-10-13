import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { CalendarError, devLoopback, fetchCalendar, hostOf, isPublicAddress, NET_LIMITS, USER_AGENT, validateCalendarUrl } from './net'

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

function reasonOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return err instanceof CalendarError ? err.reason : `other: ${String(err)}`
  }
  return 'accepted'
}

async function failure(promise: Promise<unknown>): Promise<CalendarError> {
  try {
    await promise
  } catch (err) {
    if (err instanceof CalendarError) return err
    throw new Error(`rejected with something that is not a CalendarError: ${String(err)}`)
  }
  throw new Error('resolved')
}

describe('calendar addresses', () => {
  it('reads an Outlook published calendar from its .ics twin when given the .html link', () => {
    const html = 'https://outlook.office365.com/owa/calendar/0123abcd@example.org/4567ef890123/calendar.html'
    expect(validateCalendarUrl(html).href).toBe('https://outlook.office365.com/owa/calendar/0123abcd@example.org/4567ef890123/calendar.ics')
    // Already the data link, and pages elsewhere, are left alone.
    expect(validateCalendarUrl(html.replace('.html', '.ics')).pathname.endsWith('/calendar.ics')).toBe(true)
    expect(validateCalendarUrl('https://example.org/calendar.html').pathname).toBe('/calendar.html')
  })

  it('accepts public https addresses and normalises webcal', () => {
    expect(validateCalendarUrl('https://calendar.google.com/calendar/ical/me%40example.com/private-abc123/basic.ics').href).toBe(
      'https://calendar.google.com/calendar/ical/me%40example.com/private-abc123/basic.ics'
    )
    expect(validateCalendarUrl('  webcal://p01-caldav.icloud.com/published/2/abc  ').href).toBe('https://p01-caldav.icloud.com/published/2/abc')
    expect(validateCalendarUrl('WEBCALS://Outlook.Office365.com/owa/calendar/x/reachcalendar.ics').hostname).toBe('outlook.office365.com')
    expect(validateCalendarUrl('https://example.com:443/a.ics#fragment').href).toBe('https://example.com/a.ics')
    expect(hostOf(validateCalendarUrl('https://calendar.google.com./x.ics'))).toBe('calendar.google.com')
  })

  const blocked: [string, unknown][] = [
    ['plain http', 'http://calendar.google.com/x.ics'],
    ['another scheme', 'ftp://example.com/x.ics'],
    ['file', 'file:///C:/Windows/win.ini'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/calendar,BEGIN:VCALENDAR'],
    ['no scheme', 'calendar.google.com/x.ics'],
    ['credentials', 'https://user:pass@example.com/x.ics'],
    ['a user name that looks like a host', 'https://calendar.google.com@evil.example.com/x.ics'],
    ['another port', 'https://example.com:8443/x.ics'],
    ['port 80', 'https://example.com:80/x.ics'],
    ['localhost', 'https://localhost/x.ics'],
    ['localhost with a trailing dot', 'https://localhost./x.ics'],
    ['a subdomain of localhost', 'https://calendar.localhost/x.ics'],
    ['upper-case localhost', 'https://LOCALHOST/x.ics'],
    ['a .local name', 'https://printer.local/x.ics'],
    ['a .internal name', 'https://metadata.google.internal/x.ics'],
    ['a single label', 'https://intranet/x.ics'],
    ['a single label with a dot', 'https://intranet./x.ics'],
    ['IPv4 loopback', 'https://127.0.0.1/x.ics'],
    ['a private IPv4', 'https://192.168.1.10/x.ics'],
    ['a public IPv4 literal', 'https://93.184.216.34/x.ics'],
    ['a decimal IPv4', 'https://2130706433/x.ics'],
    ['an octal IPv4', 'https://0177.0.0.1/x.ics'],
    ['a hexadecimal IPv4', 'https://0x7f.0.0.1/x.ics'],
    ['a short IPv4', 'https://127.1/x.ics'],
    ['a zero IPv4', 'https://0/x.ics'],
    ['the metadata address', 'https://169.254.169.254/latest/meta-data'],
    ['IPv6 loopback', 'https://[::1]/x.ics'],
    ['an IPv4-mapped IPv6', 'https://[::ffff:127.0.0.1]/x.ics'],
    ['an IPv4-mapped IPv6 in hex', 'https://[::ffff:7f00:1]/x.ics'],
    ['a public IPv6 literal', 'https://[2606:4700:4700::1111]/x.ics'],
    ['a link-local IPv6', 'https://[fe80::1]/x.ics'],
    ['a backslash', 'https://example.com\\@localhost/x.ics'],
    ['a space', 'https://exa mple.com/x.ics'],
    ['a control character', 'https://example.com/\u0000x.ics'],
    ['a newline', 'https://example.com/x.ics\nHost: localhost'],
    ['a full-width dot host that normalises to an address', 'https://127。0。0。1/x.ics'],
    ['an empty string', ''],
    ['not a string', { href: 'https://example.com' }],
    ['null', null],
    ['too long', `https://example.com/${'a'.repeat(NET_LIMITS.url)}`]
  ]
  it.each(blocked)('blocks %s', (_name, input) => {
    expect(reasonOf(() => validateCalendarUrl(input))).toBe('blocked-address')
  })

  it('opens the loopback seam only when the policy says so, and only for 127.0.0.1 with a port', () => {
    const seam = { allowLoopbackHttp: true }
    expect(validateCalendarUrl('http://127.0.0.1:8123/test.ics', seam).href).toBe('http://127.0.0.1:8123/test.ics')
    expect(reasonOf(() => validateCalendarUrl('http://127.0.0.1:8123/test.ics'))).toBe('blocked-address')
    for (const other of ['http://localhost:8123/x', 'http://127.0.0.2:8123/x', 'http://127.0.0.1/x', 'http://10.0.0.1:8123/x', 'http://example.com:8123/x', 'http://[::1]:8123/x', 'http://user@127.0.0.1:8123/x']) {
      expect(reasonOf(() => validateCalendarUrl(other, seam)), other).toBe('blocked-address')
    }
  })

  it('reads the seam from the environment in unpackaged builds only', () => {
    expect(devLoopback('1', false)).toBe(true)
    expect(devLoopback('1', true)).toBe(false)
    expect(devLoopback(undefined, false)).toBe(false)
    expect(devLoopback('true', false)).toBe(false)
  })

  it('never puts the address in an error', () => {
    const secret = 'https://127.0.0.1/private-SECRETTOKEN/basic.ics'
    try {
      validateCalendarUrl(secret)
      throw new Error('accepted')
    } catch (err) {
      expect(err).toBeInstanceOf(CalendarError)
      expect(String((err as Error).message)).toBe('calendar: blocked-address')
      expect(JSON.stringify(err) + String((err as Error).stack)).not.toContain('SECRETTOKEN')
    }
  })
})

describe('public addresses', () => {
  it.each(['8.8.8.8', '93.184.216.34', '142.250.79.14', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e'])('%s is public', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it.each([
    '0.0.0.0', '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '192.0.0.1',
    '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:c0a8:101', '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', '2002:7f00:1::', '2002:c0a8:101::1',
    '2001:db8::1', '2001::1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fe80::1%eth0', 'fec0::1', 'ff02::1', '100::1', '::ffff:0:127.0.0.1',
    '', 'not an address', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1:2:3', ':::', 'gggg::1'
  ])('%s is not', (address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it('still lets the public address behind a mapped or translated form through', () => {
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true)
    expect(isPublicAddress('64:ff9b::808:808')).toBe(true)
  })
})

describe('fetching (a local stub behind the loopback seam)', () => {
  let server: Server | null = null
  const seam = { policy: { allowLoopbackHttp: true } }

  async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
    server = createServer(handler)
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  afterEach(async () => {
    const closing = server
    server = null
    if (closing) {
      closing.closeAllConnections()
      await new Promise<void>((resolve) => closing.close(() => resolve()))
    }
  })

  it('reads a calendar and sends nothing that identifies the user', async () => {
    let seen: IncomingMessage['headers'] = {}
    const base = await serve((request, response) => {
      seen = request.headers
      response.writeHead(200, { 'Content-Type': 'text/calendar', ETag: '"v1"', 'Last-Modified': 'Tue, 13 Oct 2026 08:00:00 GMT', 'Set-Cookie': 'sid=1' })
      response.end(ICS)
    })
    const result = await fetchCalendar(`${base}/basic.ics`, seam)
    expect(result).toEqual({ status: 'ok', text: ICS, etag: '"v1"', lastModified: 'Tue, 13 Oct 2026 08:00:00 GMT' })
    expect(seen['user-agent']).toBe(USER_AGENT)
    expect(seen['cookie']).toBeUndefined()
    expect(seen['referer']).toBeUndefined()
    expect(seen['authorization']).toBeUndefined()
    expect(seen['origin']).toBeUndefined()
  })

  it('sends validators and understands "not modified"', async () => {
    let seen: IncomingMessage['headers'] = {}
    const base = await serve((request, response) => {
      seen = request.headers
      response.writeHead(304)
      response.end()
    })
    expect(await fetchCalendar(`${base}/basic.ics`, { ...seam, etag: '"v1"', lastModified: 'Tue, 13 Oct 2026 08:00:00 GMT' })).toEqual({ status: 'not-modified' })
    expect(seen['if-none-match']).toBe('"v1"')
    expect(seen['if-modified-since']).toBe('Tue, 13 Oct 2026 08:00:00 GMT')
  })

  it('inflates gzip', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Encoding': 'gzip' })
      response.end(gzipSync(ICS))
    })
    expect(await fetchCalendar(`${base}/basic.ics`, seam)).toMatchObject({ status: 'ok', text: ICS })
  })

  it.each([
    [404, 'not-found'],
    [410, 'not-found'],
    [401, 'forbidden'],
    [403, 'forbidden'],
    [500, 'failed'],
    [204, 'failed']
  ])('maps status %i to %s', async (status, reason) => {
    const base = await serve((_request, response) => {
      response.writeHead(status)
      response.end('private-SECRETTOKEN')
    })
    const error = await failure(fetchCalendar(`${base}/private-SECRETTOKEN/basic.ics`, seam))
    expect(error.reason).toBe(reason)
    expect(error.message).not.toContain('SECRETTOKEN')
    expect(error.message).not.toContain('127.0.0.1')
  })

  it('refuses a body over the cap, declared or not, compressed or not', async () => {
    const big = 'X'.repeat(4096)
    let base = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Length': String(big.length) })
      response.end(big)
    })
    expect((await failure(fetchCalendar(`${base}/a.ics`, { ...seam, maxBytes: 1024 }))).reason).toBe('too-large')
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    base = await serve((_request, response) => {
      response.writeHead(200)
      response.write(big.slice(0, 600))
      setTimeout(() => response.end(big), 10)
    })
    expect((await failure(fetchCalendar(`${base}/a.ics`, { ...seam, maxBytes: 1024 }))).reason).toBe('too-large')
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    // A few hundred bytes that inflate to a megabyte.
    base = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Encoding': 'gzip' })
      response.end(gzipSync('0'.repeat(1024 * 1024)))
    })
    expect((await failure(fetchCalendar(`${base}/a.ics`, { ...seam, maxBytes: 64 * 1024 }))).reason).toBe('too-large')
  })

  it('gives up after the timeout', async () => {
    const base = await serve(() => undefined)
    const started = Date.now()
    expect((await failure(fetchCalendar(`${base}/slow.ics`, { ...seam, timeoutMs: 150 }))).reason).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('counts the timeout over the whole chain of redirects', async () => {
    const base = await serve((request, response) => {
      setTimeout(() => {
        response.writeHead(302, { Location: `/hop${Number(request.url?.slice(4) ?? 0) + 1}` })
        response.end()
      }, 120)
    })
    expect((await failure(fetchCalendar(`${base}/hop0`, { ...seam, timeoutMs: 200 }))).reason).toBe('timeout')
  })

  it('reports a server that is not there as offline', async () => {
    const base = await serve(() => undefined)
    const closing = server!
    server = null
    await new Promise<void>((resolve) => closing.close(() => resolve()))
    expect((await failure(fetchCalendar(`${base}/a.ics`, seam))).reason).toBe('offline')
  })

  it('follows up to three redirects, and no more', async () => {
    let hops = 0
    const base = await serve((request, response) => {
      const at = Number(request.url?.slice(2) ?? 0)
      hops++
      if (at < 3) {
        response.writeHead(at % 2 ? 301 : 307, { Location: `/r${at + 1}` })
        response.end()
      } else {
        response.writeHead(200)
        response.end(ICS)
      }
    })
    expect(await fetchCalendar(`${base}/r0`, seam)).toMatchObject({ status: 'ok' })
    expect(hops).toBe(4)

    await new Promise<void>((resolve) => server!.close(() => resolve()))
    const endless = await serve((request, response) => {
      response.writeHead(302, { Location: `/loop${Number(request.url?.slice(5) ?? 0) + 1}` })
      response.end()
    })
    hops = 0
    expect((await failure(fetchCalendar(`${endless}/loop0`, seam))).reason).toBe('failed')
  })

  it('does not send the validators of one address to the address it redirects to', async () => {
    const headers: IncomingMessage['headers'][] = []
    const base = await serve((request, response) => {
      headers.push(request.headers)
      if (request.url === '/a') {
        response.writeHead(302, { Location: '/b' })
        response.end()
      } else {
        response.writeHead(200)
        response.end(ICS)
      }
    })
    await fetchCalendar(`${base}/a`, { ...seam, etag: '"v1"' })
    expect(headers[0]['if-none-match']).toBe('"v1"')
    expect(headers[1]['if-none-match']).toBeUndefined()
  })

  const targets: [string, string][] = [
    ['a private address', 'http://10.0.0.1/x.ics'],
    ['https on a private address', 'https://192.168.0.1/x.ics'],
    ['localhost over https', 'https://localhost/x.ics'],
    ['the metadata service', 'http://169.254.169.254/latest/meta-data/'],
    ['plain http on a public name', 'http://example.com/x.ics'],
    ['another loopback address', 'http://127.0.0.2:8080/x.ics'],
    ['IPv6 loopback', 'https://[::1]/x.ics'],
    ['a file', 'file:///etc/passwd'],
    ['another scheme', 'gopher://example.com/'],
    ['credentials', 'https://user:pw@example.com/x.ics'],
    ['another port', 'https://example.com:8443/x.ics']
  ]
  it.each(targets)('refuses a redirect to %s', async (_name, location) => {
    const base = await serve((_request, response) => {
      response.writeHead(302, { Location: location })
      response.end()
    })
    const connected: string[] = []
    const error = await failure(fetchCalendar(`${base}/start.ics`, { ...seam, onConnect: (address) => connected.push(address) }))
    expect(error.reason).toBe('blocked-address')
    // The only connection ever made was to the stub.
    expect(connected).toEqual(['127.0.0.1'])
  })

  it('refuses a redirect to a public name that resolves to a private address, without connecting', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(302, { Location: 'https://rebind.example.com/x.ics' })
      response.end()
    })
    const connected: string[] = []
    const asked: string[] = []
    const error = await failure(
      fetchCalendar(`${base}/start.ics`, {
        ...seam,
        onConnect: (address) => connected.push(address),
        resolve: async (hostname) => {
          asked.push(hostname)
          return [{ address: '127.0.0.1', family: 4 }]
        }
      })
    )
    expect(error.reason).toBe('blocked-address')
    expect(asked).toEqual(['rebind.example.com'])
    expect(connected).toEqual(['127.0.0.1'])
  })
})

describe('name resolution', () => {
  const resolvesTo = (...addresses: string[]) => ({
    resolve: async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    timeoutMs: 2000
  })

  it.each([
    ['loopback', ['127.0.0.1']],
    ['a private network', ['10.1.2.3']],
    ['link-local', ['169.254.169.254']],
    ['IPv6 loopback', ['::1']],
    ['an IPv4-mapped loopback', ['::ffff:127.0.0.1']],
    ['unique-local IPv6', ['fd00::1']],
    ['a public address and a private one', ['93.184.216.34', '192.168.1.1']],
    ['something that is not an address', ['calendar.example.com']]
  ])('blocks a name that resolves to %s, before any connection', async (_name, addresses) => {
    const connected: string[] = []
    const error = await failure(fetchCalendar('https://calendar.example.com/private-SECRETTOKEN/basic.ics', { ...resolvesTo(...addresses), onConnect: (address) => connected.push(address) }))
    expect(error.reason).toBe('blocked-address')
    expect(connected).toEqual([])
    expect(error.message).not.toContain('SECRETTOKEN')
  })

  it('reports a name that does not resolve as offline', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND calendar.example.com'), { code: 'ENOTFOUND' })
    const error = await failure(fetchCalendar('https://calendar.example.com/private-SECRETTOKEN/basic.ics', { resolve: () => Promise.reject(notFound) }))
    expect(error.reason).toBe('offline')
    // The system error names the host; what leaves here does not.
    expect(error.message).toBe('calendar: offline')
    const empty = await failure(fetchCalendar('https://calendar.example.com/x.ics', { resolve: async () => [] }))
    expect(empty.reason).toBe('offline')
  })

  it('validates the address before resolving anything', async () => {
    let asked = 0
    const error = await failure(
      fetchCalendar('https://localhost/x.ics', {
        resolve: async () => {
          asked++
          return [{ address: '93.184.216.34', family: 4 }]
        }
      })
    )
    expect(error.reason).toBe('blocked-address')
    expect(asked).toBe(0)
  })
})

// Off by default: the suite never touches the network. `SELIDA_NET_SMOKE=1 npx vitest run src/main/briefing/net.test.ts`
// makes one request to example.com to check the real https path: system resolver, pinned address, TLS by name.
describe.runIf(process.env['SELIDA_NET_SMOKE'] === '1')('network smoke test', () => {
  it('reaches a public https host through the address it validated', async () => {
    const connected: string[] = []
    const result = await fetchCalendar('https://example.com/', { onConnect: (address) => connected.push(address) })
    expect(result.status).toBe('ok')
    expect(connected).toHaveLength(1)
    expect(isPublicAddress(connected[0])).toBe(true)
  })
})
