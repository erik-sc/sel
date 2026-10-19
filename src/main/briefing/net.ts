import { lookup as dnsLookup } from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'
import { createGunzip } from 'node:zlib'
import type { CalendarErrorCode } from '../../shared/briefing'

/**
 * The one place where sel itself goes on the network: reading a calendar the user connected.
 * It runs in the main process on Node's own https client, which shares nothing with the windows:
 * no cookies, no cache, no referrer, no proxy settings, and none of the session's permissions.
 *
 * The rules, all enforced here and again after every redirect:
 *   - https only, on port 443, without credentials in the address;
 *   - the host is a name, never an IP literal, and never a local one (`localhost`, `*.local`…);
 *   - every address the name resolves to is public, and the connection is made to exactly the
 *     address that was checked (so a name cannot answer "public" first and "127.0.0.1" next);
 *   - at most 3 redirects, 10 seconds and 5 MB;
 *   - the address is a credential: it is in no error, no log line and nothing a window receives.
 *
 * Kept free of Electron imports so that the policy can be unit-tested.
 */

export const NET_LIMITS = {
  url: 2048,
  redirects: 3,
  timeoutMs: 10_000,
  bytes: 5 * 1024 * 1024
} as const

export const USER_AGENT = 'sel'

/** A failure with a sanitised reason and a fixed message: nothing of the address is in it. */
export class CalendarError extends Error {
  constructor(readonly reason: CalendarErrorCode) {
    super(`calendar: ${reason}`)
    this.name = 'CalendarError'
  }
}

export interface NetPolicy {
  /**
   * Development and tests only: also accept `http://127.0.0.1:<port>/…`, so that a calendar
   * can be served by a local stub. Never set in a packaged app (see `devLoopback`).
   */
  allowLoopbackHttp?: boolean
}

/**
 * Whether the loopback seam is on: only in an unpackaged build, and only when asked for
 * through the environment. A shipped app never reads the variable.
 */
export function devLoopback(raw: string | undefined, isPackaged: boolean): boolean {
  return !isPackaged && raw === '1'
}

// ---- addresses ------------------------------------------------------------------

function ipv4Bytes(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN))
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null
}

function publicV4(bytes: number[]): boolean {
  const [a, b, c] = bytes
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a === 169 && b === 254) return false // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false // protocol assignments, documentation
  if (a === 192 && b === 88 && c === 99) return false // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return false // benchmarking
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  if (a >= 224) return false // multicast, reserved, broadcast
  return true
}

/** The eight groups of an IPv6 address, or null. Accepts `::` and a dotted IPv4 tail. */
function ipv6Groups(address: string): number[] | null {
  let text = address.replace(/^\[|\]$/g, '')
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)
  const tail = /(^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text)
  if (tail) {
    const bytes = ipv4Bytes(tail[2])
    if (!bytes) return null
    text = `${text.slice(0, text.length - tail[2].length)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string): number[] | null => {
    if (part === '') return []
    const groups = part.split(':').map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN))
    return groups.some(Number.isNaN) ? null : groups
  }
  const head = parse(halves[0])
  const rest = halves.length === 2 ? parse(halves[1]) : []
  if (!head || !rest) return null
  if (halves.length === 1) return head.length === 8 ? head : null
  const missing = 8 - head.length - rest.length
  if (missing < 1) return null
  return [...head, ...new Array<number>(missing).fill(0), ...rest]
}

function publicV6(groups: number[]): boolean {
  const [a, b, c, d, e, f, g, h] = groups
  const embedded = (hi: number, lo: number): boolean => publicV4([hi >> 8, hi & 255, lo >> 8, lo & 255])
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    // ::, ::1, IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible form (::a.b.c.d).
    if (f === 0xffff) return embedded(g, h)
    if (f === 0) return g === 0 && h <= 1 ? false : embedded(g, h)
    return false
  }
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0xffff && f === 0) return embedded(g, h) // ::ffff:0:a.b.c.d
  if (a === 0x64 && b === 0xff9b) return c === 0 && d === 0 && e === 0 && f === 0 ? embedded(g, h) : false // NAT64
  if (a === 0x2002) return embedded(b, c) // 6to4 carries an IPv4 address
  if (a === 0x2001 && b === 0) return false // Teredo
  if (a === 0x2001 && b === 0xdb8) return false // documentation
  if ((a & 0xfe00) === 0xfc00) return false // unique local
  if ((a & 0xffc0) === 0xfe80) return false // link-local
  if ((a & 0xffc0) === 0xfec0) return false // site-local
  if ((a & 0xff00) === 0xff00) return false // multicast
  // Global unicast is 2000::/3; nothing else is routable.
  return (a & 0xe000) === 0x2000
}

/** True when `address` (an IP literal, as a resolver returns it) is a public, routable one. */
export function isPublicAddress(address: string): boolean {
  if (typeof address !== 'string' || !address) return false
  const v4 = ipv4Bytes(address)
  if (v4) return publicV4(v4)
  const v6 = ipv6Groups(address)
  return v6 ? publicV6(v6) : false
}

const LOCAL_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home',
  '.corp',
  '.home.arpa',
  '.test',
  '.example',
  '.invalid',
  '.onion'
]

/**
 * The address a calendar may be read from, normalised, or a `blocked-address` error.
 * `webcal://` is the same thing as `https://`. Parsed, never string-matched: the WHATWG parser
 * already turns `2130706433`, `0x7f.1` and `017700000001` into `127.0.0.1`, which is then an
 * IP literal like any other.
 */
export function validateCalendarUrl(input: unknown, policy: NetPolicy = {}): URL {
  const blocked = (): CalendarError => new CalendarError('blocked-address')
  if (typeof input !== 'string') throw blocked()
  let text = input.trim()
  if (!text || text.length > NET_LIMITS.url || /[\u0000- \u007f\\]/.test(text)) throw blocked()
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:/i, 'https:')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw blocked()
  }
  if (url.username || url.password) throw blocked()
  if (policy.allowLoopbackHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1' && /^\d{2,5}$/.test(url.port)) {
    url.hash = ''
    return url
  }
  if (url.protocol !== 'https:') throw blocked()
  if (url.port !== '' && url.port !== '443') throw blocked()
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  // A name with at least one dot, made of ordinary labels: no IP literal of either family
  // (those are digits-and-dots or bracketed), no single-label intranet name.
  if (!host || host.length > 253 || host.startsWith('[') || isIP(host) !== 0) throw blocked()
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) throw blocked()
  if (/^\d+$/.test(host.slice(host.lastIndexOf('.') + 1))) throw blocked()
  if (host === 'localhost' || LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) throw blocked()
  url.hostname = host
  url.hash = ''
  // Outlook publishes a calendar as two links that differ only in the ending: `calendar.html`
  // (a web page) and `calendar.ics` (the data). People tend to copy the first one.
  if (/\/owa\/calendar\/.+\/calendar\.html$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\.html$/i, '.ics')
  return url
}

/** The host a calendar's address names, which is all of it the interface ever shows. */
export function hostOf(url: URL): string {
  return url.hostname.replace(/\.$/, '')
}

// ---- fetching -------------------------------------------------------------------

export interface ResolvedAddress {
  address: string
  family: number
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)))
  })

/**
 * The one address a connection to `hostname` will be made to. Every address the name has must
 * be public (one private answer taints the name). Rejects with a `CalendarError`: `offline`
 * when the name has no address, `blocked-address` when one of them is not public.
 */
export async function resolvePinned(hostname: string, resolve: Resolver = systemResolver): Promise<ResolvedAddress> {
  const addresses = await resolve(hostname)
  if (!Array.isArray(addresses) || addresses.length === 0) throw new CalendarError('offline')
  if (!addresses.every((entry) => entry && isPublicAddress(entry.address))) throw new CalendarError('blocked-address')
  const first = addresses[0]
  return { address: first.address, family: first.family === 6 || isIP(first.address) === 6 ? 6 : 4 }
}

/** A `lookup` for Node's http(s) clients that answers with `pinned` whatever name is asked. */
export function pinnedLookup(pinned: ResolvedAddress): https.RequestOptions['lookup'] {
  return ((_hostname: string, lookupOptions: unknown, callback?: unknown): void => {
    const done = (typeof lookupOptions === 'function' ? lookupOptions : callback) as (
      err: Error | null,
      address: string | ResolvedAddress[],
      family?: number
    ) => void
    const wantsAll = typeof lookupOptions === 'object' && lookupOptions !== null && (lookupOptions as { all?: boolean }).all === true
    if (wantsAll) done(null, [pinned])
    else done(null, pinned.address, pinned.family)
  }) as unknown as https.RequestOptions['lookup']
}

export interface FetchOptions {
  etag?: string
  lastModified?: string
  policy?: NetPolicy
  /** Tests: replaces the system resolver. */
  resolve?: Resolver
  timeoutMs?: number
  maxBytes?: number
  /** Tests: called with each address a connection is made to. */
  onConnect?: (address: string) => void
}

export type FetchResult = { status: 'ok'; text: string; etag?: string; lastModified?: string } | { status: 'not-modified' }

const OFFLINE_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_NODATA',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EADDRNOTAVAIL',
  'EPIPE'
])

function reasonOf(err: unknown): CalendarErrorCode {
  if (err instanceof CalendarError) return err.reason
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout'
  return typeof code === 'string' && OFFLINE_CODES.has(code) ? 'offline' : 'failed'
}

function headerText(value: string | string[] | undefined, max: number): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : undefined
}

interface Attempt {
  redirect?: string
  result?: FetchResult
}

/** One request, to one validated address. Rejects with a CalendarError. */
function attempt(url: URL, options: FetchOptions, deadline: number, conditional: boolean): Promise<Attempt> {
  const maxBytes = options.maxBytes ?? NET_LIMITS.bytes
  const loopback = url.protocol === 'http:'
  return new Promise<Attempt>((resolve, reject) => {
    let settled = false
    let request: http.ClientRequest | null = null
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
      request?.destroy()
    }
    const fail = (reason: CalendarErrorCode): void => finish(() => reject(new CalendarError(reason)))
    const timer = setTimeout(() => fail('timeout'), Math.max(1, deadline - Date.now()))

    const start = (pinned: ResolvedAddress | null): void => {
      if (settled) return
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: 'text/calendar, text/plain;q=0.5',
        'Accept-Encoding': 'gzip, identity'
      }
      if (conditional && options.etag) headers['If-None-Match'] = options.etag
      if (conditional && options.lastModified) headers['If-Modified-Since'] = options.lastModified
      const requestOptions: https.RequestOptions = {
        method: 'GET',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (loopback ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        headers,
        // A connection of its own, closed afterwards: nothing is shared between requests.
        agent: false,
        // The connection goes to the address that was checked, whatever the name answers by then.
        ...(pinned ? { lookup: pinnedLookup(pinned) } : {})
      }
      try {
        options.onConnect?.(pinned ? pinned.address : url.hostname)
        request = (loopback ? http : https).request(requestOptions, (response) => {
          const status = response.statusCode ?? 0
          if (status >= 301 && status <= 308 && status !== 304 && status !== 305 && status !== 306) {
            const location = headerText(response.headers.location, NET_LIMITS.url)
            response.resume()
            if (!location) return fail('failed')
            return finish(() => resolve({ redirect: location }))
          }
          if (status === 304) {
            response.resume()
            return finish(() => resolve({ result: { status: 'not-modified' } }))
          }
          if (status !== 200) {
            response.resume()
            return fail(status === 404 || status === 410 ? 'not-found' : status === 401 || status === 403 ? 'forbidden' : 'failed')
          }
          const declared = Number(response.headers['content-length'])
          if (Number.isFinite(declared) && declared > maxBytes) return fail('too-large')
          const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase()
          if (encoding !== 'identity' && encoding !== 'gzip' && encoding !== 'x-gzip') return fail('failed')
          const chunks: Buffer[] = []
          let received = 0
          let size = 0
          // Both what arrives and what it inflates to are capped: a small body cannot unpack into a huge one.
          response.on('data', (chunk: Buffer) => {
            received += chunk.length
            if (received > maxBytes) fail('too-large')
          })
          const body = encoding === 'identity' ? response : response.pipe(createGunzip())
          body.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > maxBytes) return fail('too-large')
            chunks.push(chunk)
          })
          body.on('error', () => fail('failed'))
          response.on('error', () => fail('failed'))
          response.on('aborted', () => fail('offline'))
          body.on('end', () => {
            const result: FetchResult = { status: 'ok', text: Buffer.concat(chunks).toString('utf8') }
            const etag = headerText(response.headers.etag, 512)
            const lastModified = headerText(response.headers['last-modified'], 64)
            if (etag) result.etag = etag
            if (lastModified) result.lastModified = lastModified
            finish(() => resolve({ result }))
          })
        })
        request.on('error', (err) => fail(reasonOf(err)))
        request.end()
      } catch (err) {
        fail(reasonOf(err))
      }
    }

    if (loopback) return start(null)
    resolvePinned(url.hostname, options.resolve).then(start, (err: unknown) => fail(reasonOf(err)))
  })
}

/**
 * Reads a calendar file. `url` is validated here (again), and so is every redirect target.
 * Rejects with a `CalendarError` only; its message never contains the address.
 */
export async function fetchCalendar(input: string | URL, options: FetchOptions = {}): Promise<FetchResult> {
  const policy = options.policy ?? {}
  const deadline = Date.now() + (options.timeoutMs ?? NET_LIMITS.timeoutMs)
  try {
    let url = validateCalendarUrl(String(input), policy)
    for (let hop = 0; ; hop++) {
      // A redirect leads to another resource: the validators of the first one do not apply to it.
      const step = await attempt(url, options, deadline, hop === 0)
      if (step.result) return step.result
      if (hop >= NET_LIMITS.redirects) throw new CalendarError('failed')
      let next: URL
      try {
        next = new URL(step.redirect ?? '', url)
      } catch {
        throw new CalendarError('failed')
      }
      // Back through the whole policy: https, port, name, and (in `attempt`) public addresses.
      url = validateCalendarUrl(next.href, policy)
    }
  } catch (err) {
    throw err instanceof CalendarError ? err : new CalendarError(reasonOf(err))
  }
}
