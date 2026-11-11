import { describe, expect, it } from 'vitest'
import { addressOf, approvalUrl, closeTunnel, findTailscale, funnelReaches, openTunnel, type Runner } from './tunnel'

const STATUS = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'Erik-PC.tail1234.ts.net.' } })
const SERVING = (port: number, funnel = true): string =>
  JSON.stringify({
    TCP: { 443: { HTTPS: true } },
    Web: { 'erik-pc.tail1234.ts.net:443': { Handlers: { '/': { Proxy: `http://127.0.0.1:${port}` } } } },
    AllowFunnel: { 'erik-pc.tail1234.ts.net:443': funnel }
  })

/** A `tailscale` that answers from a script, and remembers what it was asked. */
function fake(answers: Record<string, { code?: number | null; out: string }>): { run: Runner; asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    run: async (args) => {
      const line = args.join(' ')
      asked.push(line)
      const key = Object.keys(answers).find((prefix) => line.startsWith(prefix))
      const answer = key ? answers[key] : { out: '' }
      return { code: answer.code === undefined ? 0 : answer.code, out: answer.out }
    }
  }
}

describe('finding tailscale', () => {
  it('looks in its usual folder on Windows, then in the absolute folders of PATH', () => {
    const usual = 'C:\\Program Files\\Tailscale\\tailscale.exe'
    expect(findTailscale('win32', { ProgramFiles: 'C:\\Program Files' }, (path) => path === usual)).toBe(usual)
    const onPath = '/opt/ts/tailscale'
    expect(findTailscale('linux', { PATH: `relative:/opt/ts` }, (path) => path === onPath)).toBe(onPath)
    // A relative folder of PATH is never searched.
    expect(findTailscale('linux', { PATH: 'bin' }, (path) => path === 'bin/tailscale')).toBeNull()
    expect(findTailscale('win32', { Path: 'D:\\tools;relative' }, (path) => path === 'D:\\tools\\tailscale.exe')).toBe(
      'D:\\tools\\tailscale.exe'
    )
    expect(findTailscale('win32', {}, () => false)).toBeNull()
  })
})

describe('reading what tailscale says', () => {
  it('takes this computer’s address only when Tailscale is running', () => {
    expect(addressOf(STATUS)).toBe('https://erik-pc.tail1234.ts.net')
    expect(addressOf(`Warning: something\n${STATUS}`)).toBe('https://erik-pc.tail1234.ts.net')
    expect(addressOf(JSON.stringify({ BackendState: 'NeedsLogin', Self: { DNSName: 'x.ts.net.' } }))).toBeNull()
    expect(addressOf(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'evil.example/path' } }))).toBeNull()
    expect(addressOf('not json')).toBeNull()
  })

  it('knows the tunnel is open only when the internet reaches this port on 443', () => {
    expect(funnelReaches(SERVING(47615), 47615)).toBe(true)
    expect(funnelReaches(SERVING(8766), 47615)).toBe(false)
    // Served inside the tailnet only: not open to the phone.
    expect(funnelReaches(SERVING(47615, false), 47615)).toBe(false)
    expect(funnelReaches('{}', 47615)).toBe(false)
    expect(funnelReaches('', 47615)).toBe(false)
  })

  it('finds the page Tailscale asks to open, and no other address', () => {
    expect(
      approvalUrl('Funnel is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/funnel?node=abc123\n')
    ).toBe('https://login.tailscale.com/f/funnel?node=abc123')
    expect(approvalUrl('visit https://login.tailscale.com.evil.example/f')).toBeNull()
    expect(approvalUrl('nothing here')).toBeNull()
  })
})

describe('opening the tunnel', () => {
  it('says what is missing: the program, or the sign-in', async () => {
    expect(await openTunnel(null, 47615)).toEqual({ state: 'no-tailscale', address: '', approveUrl: null })
    const out = fake({ status: { out: JSON.stringify({ BackendState: 'NeedsLogin' }) } })
    expect(await openTunnel(out.run, 47615)).toEqual({ state: 'signed-out', address: '', approveUrl: null })
    // Nothing was opened.
    expect(out.asked).toEqual(['status --json'])
  })

  it('points Funnel at the port and gives the address', async () => {
    const ts = fake({
      status: { out: STATUS },
      'funnel --bg': { out: 'Available on the internet' },
      'funnel status': { out: SERVING(47615) }
    })
    expect(await openTunnel(ts.run, 47615)).toEqual({ state: 'on', address: 'https://erik-pc.tail1234.ts.net', approveUrl: null })
    expect(ts.asked).toEqual(['status --json', 'funnel --bg --https=443 http://127.0.0.1:47615', 'funnel status --json'])
  })

  it('hands over the page to allow Funnel when Tailscale asks, and says when it would not open', async () => {
    const asks = fake({
      status: { out: STATUS },
      'funnel --bg': { code: null, out: 'To enable, visit: https://login.tailscale.com/f/funnel?node=abc' },
      'funnel status': { out: '{}' }
    })
    expect(await openTunnel(asks.run, 47615)).toEqual({
      state: 'needs-approval',
      address: 'https://erik-pc.tail1234.ts.net',
      approveUrl: 'https://login.tailscale.com/f/funnel?node=abc'
    })
    const fails = fake({ status: { out: STATUS }, 'funnel --bg': { code: 1, out: 'error' }, 'funnel status': { out: SERVING(8766) } })
    expect((await openTunnel(fails.run, 47615)).state).toBe('failed')
    // An older Tailscale that prints no JSON: its own success is taken.
    const old = fake({ status: { out: STATUS }, 'funnel --bg': { out: 'ok' }, 'funnel status': { out: 'https://erik-pc… (Funnel on)' } })
    expect((await openTunnel(old.run, 47615)).state).toBe('on')
  })

  it('closes only through the one command', async () => {
    const ts = fake({})
    await closeTunnel(ts.run)
    expect(ts.asked).toEqual(['funnel --https=443 off'])
    await closeTunnel(null)
  })
})
