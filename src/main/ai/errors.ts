import type { AiErrorCode } from '../../shared/ai'

/**
 * Turning a failed run into something a person can act on. What the program printed never
 * reaches the renderer as is: it is matched for a cause, and at most one short line of it,
 * stripped of paths, is passed along as a detail.
 */

export const AI_MESSAGES: Record<AiErrorCode, string> = {
  'not-installed': 'Claude Code was not found on this computer.',
  'not-logged-in': 'Claude Code is not signed in. Run "claude" in a terminal once to sign in, then try again.',
  'rate-limited': 'Claude is busy, or your plan has reached its usage limit. Try again in a while.',
  timeout: 'The request took too long and was stopped.',
  cancelled: 'The request was cancelled.',
  failed: 'Claude Code could not complete the request.'
}

const NOT_LOGGED_IN_RE =
  /not logged in|please run \/login|run `?claude(?: \/)?login|invalid api key|authentication[_ ]error|authentication failed|oauth token (?:has )?expired|token (?:has )?expired|unauthori[sz]ed|\b401\b|credentials? (?:not found|missing|required)|no (?:api key|credentials)/i
const RATE_LIMITED_RE = /rate[ _-]?limit|usage limit|limit reached|too many requests|\b429\b|overloaded|\b529\b|quota/i

const MAX_DETAIL_CHARS = 160

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g
/** Windows (`C:\…`, `\\server\…`) and POSIX absolute paths, and `~/…`. */
const PATH_RE = /(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?=[A-Za-z0-9._-]+[\\/]))[^\s"'<>|:*?]*(?::\d+)*/g
/** Things that look like credentials: long opaque tokens, `sk-…` keys, bearer values. */
const SECRET_RE = /\b(?:sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,}|Bearer\s+\S+)/g

/** One short line that is safe to show: no escape codes, no paths, no token-shaped strings. */
export function sanitizeDetail(text: string | undefined | null): string | undefined {
  if (!text) return undefined
  const cleaned = text.replace(ANSI_RE, '').replace(/\r/g, '\n')
  for (const raw of cleaned.split('\n')) {
    const line = raw.replace(CONTROL_RE, '').replace(PATH_RE, '…').replace(SECRET_RE, '…').replace(/\s+/g, ' ').trim()
    // A line that is only brackets, a stack frame or JSON is not worth showing.
    if (!line || /^[\s{}[\](),;:…]+$/.test(line) || /^at\s/.test(line) || line.startsWith('{')) continue
    return line.length > MAX_DETAIL_CHARS ? `${line.slice(0, MAX_DETAIL_CHARS - 1)}…` : line
  }
  return undefined
}

export interface Failure {
  code: AiErrorCode
  message: string
  detail?: string
}

export function failure(code: AiErrorCode, detail?: string): Failure {
  const out: Failure = { code, message: AI_MESSAGES[code] }
  if (detail) out.detail = detail
  return out
}

/**
 * Classifies a run that did not produce an answer, from everything the program said: the text
 * of an error result, its stderr, and how it exited.
 */
export function classifyFailure(input: {
  resultText?: string
  stderr?: string
  exitCode?: number | null
  spawnErrorCode?: string
}): Failure {
  if (input.spawnErrorCode === 'ENOENT' || input.spawnErrorCode === 'EACCES' || input.spawnErrorCode === 'EPERM') {
    return failure('not-installed')
  }
  const said = `${input.resultText ?? ''}\n${input.stderr ?? ''}`
  const detail = sanitizeDetail(input.resultText) ?? sanitizeDetail(input.stderr)
  if (NOT_LOGGED_IN_RE.test(said)) return failure('not-logged-in')
  if (RATE_LIMITED_RE.test(said)) return failure('rate-limited', detail)
  // cmd.exe (9009) and POSIX shells (127) when the shim's target is gone.
  if (input.exitCode === 9009 || input.exitCode === 127) return failure('not-installed')
  return failure('failed', detail)
}
