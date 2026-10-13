import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, statfs } from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { dirname } from 'node:path'
import { CalendarError, pinnedLookup, resolvePinned, USER_AGENT, validateCalendarUrl, type NetPolicy, type Resolver } from '../../briefing/net'
import type { PinnedFile } from './pinned'

/**
 * Downloads one pinned file. Built on the audited https reader of the briefing (./briefing/
 * net.ts) and under the same rules, enforced on the first request and again on every redirect:
 * https on port 443 without credentials, a host name whose every address is public, and the
 * connection made to exactly the address that was checked. On top of those:
 *   - the host must be on the allow-list, exactly;
 *   - the file may be no longer than the pinned size (what arrives beyond it ends the transfer);
 *   - it is written under a temporary name and renamed only when its SHA-256 equals the pinned
 *     digest; a mismatch deletes it;
 *   - an interrupted transfer continues where it stopped (a `Range` request), and since the
 *     digest covers the whole file, a server that answers a range with something else gains nothing.
 * Free of Electron imports (unit-tested against a local server).
 */

export type DownloadFailure = 'blocked-host' | 'offline' | 'timeout' | 'not-found' | 'too-large' | 'digest-mismatch' | 'disk-full' | 'cancelled' | 'failed'

const MESSAGES: Record<DownloadFailure, string> = {
  'blocked-host': 'The download was sent to a server that is not on the list of allowed ones, so it was stopped.',
  offline: 'The server could not be reached. Check the connection and try again.',
  timeout: 'The download stopped responding. Try again; it continues where it left off.',
  'not-found': 'The file is no longer at its address.',
  'too-large': 'The file on the server is larger than the one sel expects, so it was refused.',
  'digest-mismatch': 'The downloaded file is not the one sel expects (its checksum is different). It was deleted.',
  'disk-full': 'There is not enough free disk space for the download.',
  cancelled: 'The download was cancelled.',
  failed: 'The download failed.'
}

export class DownloadError extends Error {
  constructor(
    readonly reason: DownloadFailure,
    /** The host that was refused, for `blocked-host`: a name, never an address with a path. */
    readonly host?: string
  ) {
    super(host ? `${MESSAGES[reason]} (${host})` : MESSAGES[reason])
    this.name = 'DownloadError'
  }
}

export const DOWNLOAD_LIMITS = { redirects: 5, idleMs: 30_000, spareBytes: 64 * 1024 * 1024 } as const

export interface DownloadOptions {
  hosts: ReadonlySet<string>
  /** Development and tests only: also `http://127.0.0.1:<port>` (see `devLoopback` in net.ts). */
  policy?: NetPolicy
  resolve?: Resolver
  signal?: AbortSignal
  onProgress?(received: number, total: number): void
  /** Free bytes on the volume of a directory. Tests replace it. */
  freeBytes?(dir: string): Promise<number>
  idleMs?: number
}

async function freeBytesOf(dir: string): Promise<number> {
  const info = await statfs(dir)
  return Number(info.bavail) * Number(info.bsize)
}

/** The address, checked against the whole policy. Throws `blocked-host`. */
export function checkDownloadUrl(input: string, options: Pick<DownloadOptions, 'hosts' | 'policy'>): URL {
  let url: URL
  try {
    url = validateCalendarUrl(input, options.policy)
  } catch {
    let host: string | undefined
    try {
      host = new URL(input).hostname.slice(0, 80)
    } catch {
      /* not even an address */
    }
    throw new DownloadError('blocked-host', host)
  }
  // The loopback seam (unpackaged builds) is the one thing that is not on the list.
  if (url.protocol === 'http:') return url
  if (!options.hosts.has(url.hostname)) throw new DownloadError('blocked-host', url.hostname)
  return url
}

export async function sha256File(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(file, { signal })
  for await (const chunk of stream) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function toFailure(err: unknown): DownloadError {
  if (err instanceof DownloadError) return err
  if (err instanceof CalendarError) {
    return new DownloadError(err.reason === 'blocked-address' ? 'blocked-host' : err.reason === 'offline' ? 'offline' : err.reason === 'timeout' ? 'timeout' : 'failed')
  }
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOSPC' || code === 'EDQUOT') return new DownloadError('disk-full')
  if (code === 'ABORT_ERR' || (err as Error | null)?.name === 'AbortError') return new DownloadError('cancelled')
  if (code === 'ETIMEDOUT') return new DownloadError('timeout')
  if (typeof code === 'string' && /^(ENOTFOUND|EAI_|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ECONNRESET|ECONNABORTED|EPIPE)/.test(code)) return new DownloadError('offline')
  return new DownloadError('failed')
}

interface Step {
  redirect?: string
  /** Bytes the temporary file holds after this request. */
  size?: number
}

/** One request to one validated address, appending to `part` from `offset`. */
function request(url: URL, part: string, offset: number, spec: PinnedFile, options: DownloadOptions): Promise<Step> {
  const idleMs = options.idleMs ?? DOWNLOAD_LIMITS.idleMs
  return new Promise<Step>((resolve, reject) => {
    let settled = false
    let req: http.ClientRequest | null = null
    let timer: NodeJS.Timeout | null = null
    const onAbort = (): void => fail(new DownloadError('cancelled'))
    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      req?.destroy()
    }
    const fail = (err: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(toFailure(err))
    }
    const done = (step: Step): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(step)
    }
    const alive = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => fail(new DownloadError('timeout')), idleMs)
    }
    if (options.signal?.aborted) return fail(new DownloadError('cancelled'))
    options.signal?.addEventListener('abort', onAbort, { once: true })
    alive()

    const loopback = url.protocol === 'http:'
    const start = (lookup: https.RequestOptions['lookup'] | undefined): void => {
      if (settled) return
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream, */*;q=0.5', 'Accept-Encoding': 'identity' }
      if (offset > 0) headers['Range'] = `bytes=${offset}-`
      req = (loopback ? http : https).request(
        { method: 'GET', protocol: url.protocol, hostname: url.hostname, port: url.port || (loopback ? 80 : 443), path: `${url.pathname}${url.search}`, headers, agent: false, ...(lookup ? { lookup } : {}) },
        (response) => {
          const status = response.statusCode ?? 0
          if (status >= 301 && status <= 308 && status !== 304 && status !== 305 && status !== 306) {
            const location = response.headers.location
            response.resume()
            return typeof location === 'string' && location.length <= 4096 ? done({ redirect: location }) : fail(new DownloadError('failed'))
          }
          // The part on disk is already everything the server has: nothing more to fetch.
          if (status === 416 && offset > 0) {
            response.resume()
            return done({ size: offset })
          }
          if (status !== 200 && status !== 206) {
            response.resume()
            return fail(new DownloadError(status === 404 || status === 410 ? 'not-found' : 'failed'))
          }
          // 200 to a range request: the server sends the whole file, so the part starts over.
          const from = status === 206 ? offset : 0
          if (status === 206 && !new RegExp(`^bytes ${offset}-`).test(String(response.headers['content-range'] ?? ''))) {
            response.resume()
            return fail(new DownloadError('failed'))
          }
          const declared = Number(response.headers['content-length'])
          if (Number.isFinite(declared) && from + declared > spec.size) {
            response.resume()
            return fail(new DownloadError('too-large'))
          }
          let received = from
          void (async () => {
            const handle = await open(part, from === 0 ? 'w' : 'r+')
            try {
              let position = from
              for await (const chunk of response as AsyncIterable<Buffer>) {
                if (settled) return
                alive()
                received += chunk.length
                if (received > spec.size) throw new DownloadError('too-large')
                await handle.write(chunk, 0, chunk.length, position)
                position += chunk.length
                options.onProgress?.(received, spec.size)
              }
            } finally {
              await handle.close()
            }
            done({ size: received })
          })().catch(fail)
        }
      )
      req.on('error', fail)
      req.end()
    }

    if (loopback) start(undefined)
    else resolvePinned(url.hostname, options.resolve).then((pinned) => start(pinnedLookup(pinned)), fail)
  })
}

/**
 * Brings `spec` to `target`: resumes `<target>.part` when there is one, verifies the whole
 * file, renames it into place. Rejects with a `DownloadError`; `target` only ever exists verified.
 */
export async function downloadVerified(spec: PinnedFile, target: string, options: DownloadOptions): Promise<void> {
  const part = `${target}.part`
  const dir = dirname(target)
  try {
    await mkdir(dir, { recursive: true })
    let have = await stat(part).then(
      (info) => (info.isFile() ? info.size : -1),
      () => 0
    )
    // Something that is not a file, or longer than the file can be: not a part of ours.
    if (have < 0 || have > spec.size) {
      await rm(part, { recursive: true, force: true })
      have = 0
    }
    const free = await (options.freeBytes ?? freeBytesOf)(dir)
    if (free < spec.size - have + DOWNLOAD_LIMITS.spareBytes) throw new DownloadError('disk-full')

    let url = checkDownloadUrl(spec.url, options)
    options.onProgress?.(have, spec.size)
    for (let hop = 0; have < spec.size; hop++) {
      if (hop > DOWNLOAD_LIMITS.redirects) throw new DownloadError('failed')
      const step = await request(url, part, have, spec, options)
      if (step.redirect === undefined) {
        have = step.size ?? have
        break
      }
      let next: string
      try {
        next = new URL(step.redirect, url).href
      } catch {
        throw new DownloadError('failed')
      }
      // Back through the whole policy, allow-list included.
      url = checkDownloadUrl(next, options)
    }
    // A transfer that ended early is kept: the next try continues from it.
    if (have < spec.size) throw new DownloadError('offline')
    const digest = await sha256File(part, options.signal)
    if (digest !== spec.sha256.toLowerCase()) {
      await rm(part, { force: true })
      throw new DownloadError('digest-mismatch')
    }
    await rename(part, target)
  } catch (err) {
    const failure = toFailure(err)
    // What is larger than it may be is never something to continue from.
    if (failure.reason === 'too-large') await rm(part, { force: true }).catch(() => undefined)
    throw failure
  }
}
