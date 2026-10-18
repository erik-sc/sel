// URL allow-lists for everything the editor links to, loads or styles with.
// Content reaches the editor from paste, drag-drop, Markdown import and other
// windows, so every url is validated where it is *used*, not only where it is set.
// Pure; unit tested.
import { parsePageLink } from '@shared/pageLink'
import { isCssCover } from './blockTypes'

export const MAX_URL_LENGTH = 2048

/**
 * Characters that never appear in a url we accept: control characters and any
 * whitespace (`java\tscript:`), invisible/bidi formatting characters (spoofing),
 * backslashes (browsers read `https://a.com\@b.com` differently from humans) and
 * the delimiters that could close an attribute or a CSS string.
 */
const UNSAFE_URL_CHARS = /[\u0000-\u0020\u007f-\u009f\s\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff\\"<>`]/

const WEB_PROTOCOL = /^https?:\/\//i
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/
/** `sel-file://files/<generated name>.<ext>`: the only shape the main process serves. */
const LOCAL_IMAGE = /^sel-file:\/\/files\/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,5}$/

function wellFormed(url: string): boolean {
  return url.length > 0 && url.length <= MAX_URL_LENGTH && !UNSAFE_URL_CHARS.test(url)
}

/** A parseable http(s) url with a host and no embedded credentials (`https://bank.com@evil.com`). */
function isWebUrl(url: string): boolean {
  if (!WEB_PROTOCOL.test(url)) return false
  try {
    const u = new URL(url)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && !u.username && !u.password
  } catch {
    return false
  }
}

/** Only http, https and mailto links are allowed. Bare domains get https://. */
export function sanitizeHref(raw: string | undefined | null): string | null {
  const url = typeof raw === 'string' ? raw.trim() : ''
  if (!wellFormed(url)) return null
  if (WEB_PROTOCOL.test(url)) return isWebUrl(url) ? url : null
  if (/^mailto:[^/]/i.test(url)) return url
  if (BARE_DOMAIN.test(url)) {
    const full = `https://${url}`
    return isWebUrl(full) ? full : null
  }
  return null
}

/**
 * What a link mark in text may point at: what `sanitizeHref` allows, or another page of the
 * workspace (`sel://page/<id>`, see @shared/pageLink). Bookmarks and other things handed to
 * the system keep to `sanitizeHref`.
 */
export function sanitizeLink(raw: string | undefined | null): string | null {
  const url = typeof raw === 'string' ? raw.trim() : ''
  return parsePageLink(url) ? url : sanitizeHref(url)
}

export function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

/** Image sources we are willing to load: files stored by the app and remote http(s) images. */
export function isSafeImageUrl(url: string | undefined | null): url is string {
  if (typeof url !== 'string' || !wellFormed(url)) return false
  return LOCAL_IMAGE.test(url) || isWebUrl(url)
}

/**
 * A CSS `url("...")` token for a safe image url, or null. The url is validated
 * first and anything that could end the string or the function is escaped anyway.
 */
export function cssImage(url: string | undefined | null): string | null {
  if (!isSafeImageUrl(url)) return null
  const escaped = url.replace(/["'()\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `url("${escaped}")`
}

export interface CoverStyle {
  background?: string
  backgroundImage?: string
}

/** Inline style for a page cover: a token-based colour/gradient or a safe image. */
export function coverStyle(cover: string | undefined | null): CoverStyle | null {
  if (typeof cover !== 'string' || !cover) return null
  if (isCssCover(cover)) return { background: cover }
  const image = cssImage(cover)
  return image ? { backgroundImage: image } : null
}

/** Raster formats the main process stores (it sniffs the bytes as well). SVG is deliberately absent. */
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp'
}
const IMAGE_EXTENSIONS = new Set(Object.values(IMAGE_EXTENSION_BY_MIME).concat('jpeg'))

/** Extension to store a pasted/dropped image under, or null when the format is not accepted. */
export function imageExtension(name: string, mime: string): string | null {
  const byMime = IMAGE_EXTENSION_BY_MIME[mime.toLowerCase()]
  if (byMime) return byMime
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1].toLowerCase()
  return ext && IMAGE_EXTENSIONS.has(ext) ? ext : null
}
