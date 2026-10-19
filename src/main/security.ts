import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])
const EXTERNAL_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])
const NETWORK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:'])
const MAILTO_PARAMS: ReadonlySet<string> = new Set(['subject', 'body', 'cc', 'bcc'])
const MAX_EXTERNAL_URL = 2048

/**
 * The dev-server URL to load instead of the bundled renderer. Whatever it points
 * at becomes a trusted ipc sender, so it is honoured only in unpackaged builds
 * and only for a loopback http origin: an environment variable must never be
 * able to point a shipped app at a remote page.
 */
export function resolveDevUrl(raw: string | undefined, isPackaged: boolean): string | undefined {
  if (!raw || isPackaged) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

/** Dev-server URL injected by electron-vite; undefined in packaged/preview builds. */
export const DEV_URL: string | undefined = resolveDevUrl(process.env['ELECTRON_RENDERER_URL'], app.isPackaged)

/** The renderer entry on disk (the bundle lives in out/main, the renderer in out/renderer). */
export const RENDERER_FILE = join(__dirname, '../renderer/index.html')

function samePath(a: string, b: string): boolean {
  const x = normalize(a)
  const y = normalize(b)
  return process.platform === 'win32' || process.platform === 'darwin' ? x.toLowerCase() === y.toLowerCase() : x === y
}

/** True when `url` is the app's own renderer (ignoring query and hash). */
export function isAppUrl(url: string, devUrl: string | undefined = DEV_URL, rendererFile: string = RENDERER_FILE): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (devUrl) {
    try {
      return parsed.origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  // A file url with a host is a UNC path (\\host\share\…), never the local bundle.
  if (parsed.protocol !== 'file:' || parsed.host) return false
  try {
    return samePath(fileURLToPath(parsed), rendererFile)
  } catch {
    return false
  }
}

/** Only the top-level frame of a window showing the app itself may talk to the main process. */
export function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  try {
    const frame = event.senderFrame
    if (!frame || event.sender.isDestroyed()) return false
    if (frame !== event.sender.mainFrame) return false
    return isAppUrl(frame.url)
  } catch {
    // The frame was torn down between the message and this check.
    return false
  }
}

/**
 * Normalizes a link the OS may open: http(s) and mailto only, parsed (never
 * string-matched), without credentials or control characters. Returns the
 * canonical href, or null when the url must not leave the app.
 */
export function toExternalUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url || url.length > MAX_EXTERNAL_URL) return null
  if (/[\u0000-\u001f\u007f]/.test(url)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null
  if (parsed.protocol === 'mailto:') {
    if (!parsed.pathname) return null
    // `attach` and friends make some mail clients pick up local files.
    for (const key of parsed.searchParams.keys()) if (!MAILTO_PARAMS.has(key.toLowerCase())) return null
  } else if (!parsed.hostname || parsed.username || parsed.password) {
    return null
  }
  return parsed.href
}

/**
 * The network policy, enforced in the main process on top of the page's CSP:
 * the renderer may talk to the dev server (unpackaged builds only) and load
 * remote images over https. Everything else on a network scheme is cancelled.
 * Local schemes (file:, data:, blob:, devtools:, sel-file:) are not network
 * access and are left to the CSP.
 */
export function isAllowedRequest(url: string, resourceType: string, devUrl: string | undefined = DEV_URL): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!NETWORK_PROTOCOLS.has(parsed.protocol)) return true
  if (isDevServerUrl(parsed, devUrl)) return true
  return parsed.protocol === 'https:' && resourceType === 'image'
}

/** True for the dev server's own http and websocket (HMR) endpoints. */
export function isDevServerUrl(url: URL, devUrl: string | undefined = DEV_URL): boolean {
  if (!devUrl) return false
  const dev = new URL(devUrl)
  return (url.protocol === 'http:' || url.protocol === 'ws:') && url.host === dev.host
}
