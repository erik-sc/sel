// Where the browser comes back to after signing in to Google: a server on this computer only, on
// a port of the moment, that takes one answer and closes.
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Waiting {
  /** The address given to Google to come back to. */
  redirectUri: string
  /** The code, once the browser is back. Rejects when it was refused, or nobody came. */
  code: Promise<string>
  /** Stops waiting. */
  close(): void
}

const page = (title: string, line: string): string =>
  `<!doctype html><meta charset="utf-8"><title>sel</title><body style="font:16px system-ui;max-width:28rem;margin:20vh auto;padding:0 1rem;color:#222"><h1 style="font-size:1.25rem">${title}</h1><p>${line}</p></body>`

/** Listens for the answer to the sign-in that carries `state`. */
export function waitForCode(state: string, timeoutMs: number): Promise<Waiting> {
  return new Promise((resolveWaiting, rejectWaiting) => {
    let settle: { resolve(code: string): void; reject(error: Error): void } | null = null
    const code = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })
    // Nobody may be waiting on it yet when it fails.
    code.catch(() => undefined)
    let timer: ReturnType<typeof setTimeout> | null = null
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const answer = (status: number, title: string, line: string): void => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        res.end(page(title, line))
      }
      if (req.method !== 'GET' || url.pathname !== '/') return answer(404, 'Not here', 'Nothing to see at this address.')
      // An answer that is not to this sign-in is not an answer: it changes nothing.
      if (url.searchParams.get('state') !== state) return answer(400, 'Not this sign-in', 'Go back to sel and sign in again.')
      const got = url.searchParams.get('code')
      if (got) {
        answer(200, 'Signed in', 'You can close this tab and go back to sel.')
        settle?.resolve(got)
      } else {
        answer(200, 'Not signed in', 'Google did not sign you in. Go back to sel to try again.')
        settle?.reject(
          new Error(
            url.searchParams.get('error') === 'access_denied' ? 'The sign-in was refused in the browser.' : 'Google did not sign in.'
          )
        )
      }
      close()
    })
    const close = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      server.close()
      settle?.reject(new Error('The sign-in was given up on.'))
    }
    server.once('error', (error) => rejectWaiting(error))
    // This computer only, and whatever port is free: Google takes any port on 127.0.0.1 for a desktop client.
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      timer = setTimeout(close, timeoutMs)
      timer.unref()
      resolveWaiting({ redirectUri: `http://127.0.0.1:${port}`, code, close })
    })
  })
}
