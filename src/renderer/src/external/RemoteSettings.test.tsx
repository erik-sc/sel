// @vitest-environment happy-dom
// Settings → MCP: the one switch of "Claude on your phone", what it says when something is
// missing, and that everything else is under Advanced.
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALARMS_SETTING } from '@shared/alarms'
import type { RemoteStatus, TunnelStatus } from '@shared/mcp'
import { cleanup, fakeApi, render, seriousViolations, settle } from '@/a11y/testing'
import { McpSection as McpSettings } from './McpSettings'
import { phoneLine } from './RemoteSettings'

const OFF: TunnelStatus = { state: 'off', address: '', approveUrl: null }

const status = (over: Partial<RemoteStatus> = {}): RemoteStatus => ({
  enabled: false,
  publicUrl: '',
  port: 47615,
  githubClientId: '',
  githubLogin: '',
  tunnel: 'manual',
  running: false,
  error: null,
  owner: null,
  mcpUrl: 'http://127.0.0.1:47615/mcp',
  claudeCode: 'claude mcp add --transport http --scope user sel-remote http://127.0.0.1:47615/mcp',
  grants: [],
  calls: [],
  pairingUntil: null,
  staysRunning: false,
  tunnelStatus: OFF,
  ...over
})

const ON = status({
  enabled: true,
  running: true,
  tunnel: 'tailscale',
  publicUrl: 'https://erik-pc.tail1234.ts.net',
  mcpUrl: 'https://erik-pc.tail1234.ts.net/mcp',
  staysRunning: true,
  tunnelStatus: { state: 'on', address: 'https://erik-pc.tail1234.ts.net', approveUrl: null },
  owner: 'erik-sc',
  grants: [
    {
      id: 'g1',
      client: 'Claude',
      redirectHost: 'claude.ai',
      login: 'erik-sc',
      scopes: ['read', 'tasks', 'finance'],
      createdAt: 1,
      lastUsedAt: null
    }
  ]
})

let phone: ReturnType<typeof vi.fn>
let setSetting: ReturnType<typeof vi.fn>
let openExternal: ReturnType<typeof vi.fn>
let pairRemote: ReturnType<typeof vi.fn>

function install(now: RemoteStatus, after: RemoteStatus = now): void {
  phone = vi.fn(async () => after)
  setSetting = vi.fn(async () => undefined)
  openExternal = vi.fn(async () => undefined)
  pairRemote = vi.fn(async () => ({ ...now, pairingUntil: Date.now() + 600_000 }))
  const base = fakeApi() as Record<string, unknown>
  const mcp = {
    status: async () => ({
      enabled: false,
      running: false,
      error: null,
      persistent: true,
      claudeCode: 'claude mcp add sel',
      claudeDesktop: '{}',
      calls: []
    }),
    remoteStatus: async () => now,
    phone,
    pairRemote,
    revokeRemote: vi.fn(async () => now),
    configureRemote: vi.fn(async () => now),
    rotateToken: vi.fn()
  }
  ;(window as unknown as { api: unknown }).api = new Proxy(base, {
    get: (target, prop) =>
      prop === 'mcp' ? mcp : prop === 'app' ? { ...(target['app'] as object), setSetting, openExternal } : target[prop as string]
  })
}

const text = (): string => document.body.textContent ?? ''
const button = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label) as HTMLButtonElement
const click = async (el: Element): Promise<void> => {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
  await settle()
}

afterEach(cleanup)

describe('where “Claude on your phone” stands', () => {
  it('says one thing, and what to do about it', () => {
    expect(phoneLine(status())).toMatchObject({ error: false, action: null })
    expect(phoneLine(ON)).toEqual({ text: 'On. It starts with sel, by itself.', error: false, action: null })
    const tunnel = (state: TunnelStatus['state']): RemoteStatus =>
      status({ enabled: true, running: true, tunnel: 'tailscale', tunnelStatus: { ...OFF, state } })
    expect(phoneLine(tunnel('no-tailscale'))).toMatchObject({ error: true, action: 'install' })
    expect(phoneLine(tunnel('signed-out'))).toMatchObject({ error: true, action: 'retry' })
    expect(phoneLine(tunnel('needs-approval'))).toMatchObject({ error: true, action: 'approve' })
    expect(phoneLine(tunnel('failed'))).toMatchObject({ error: true, action: 'retry' })
    expect(phoneLine(status({ enabled: true, error: 'The port is taken.' }))).toMatchObject({ text: 'The port is taken.', error: true })
    // An address typed under Advanced: on, with nothing to do.
    expect(phoneLine(status({ enabled: true, running: true, publicUrl: 'https://sel.example.com' }))).toMatchObject({
      error: false,
      action: null
    })
  })
})

describe('Settings → MCP', () => {
  it('opens with one switch; the rest is under Advanced, closed', async () => {
    install(status())
    await render(<McpSettings />)
    await settle()
    expect(text()).toContain('Claude on your phone')
    expect(text()).toContain('Off: Claude cannot reach sel from outside this computer.')
    const advanced = document.querySelector('details.ui-advanced') as HTMLDetailsElement
    expect(advanced.open).toBe(false)
    expect(advanced.textContent).toContain('Public address')
    expect(advanced.textContent).toContain('Apps on this computer')
    // Nothing to connect to yet: no address is offered.
    expect(button('Copy address')).toBeUndefined()
    expect(await seriousViolations()).toEqual([])
  })

  it('turning it on keeps sel running and starting with the computer, then opens the way in', async () => {
    install(status(), ON)
    await render(<McpSettings />)
    await settle()
    await click(button('On'))
    expect(setSetting).toHaveBeenCalledWith(ALARMS_SETTING.tray, true)
    expect(setSetting).toHaveBeenCalledWith(ALARMS_SETTING.openAtLogin, true)
    expect(phone).toHaveBeenCalledWith(true)
    expect(text()).toContain('On. It starts with sel, by itself.')
    expect(text()).toContain('https://erik-pc.tail1234.ts.net/mcp')
    expect(text()).toContain('Claude · claude.ai')
    expect(text()).toContain('erik-sc · reads, manages tasks, manages finances')
    await click(button('Allow for 10 minutes'))
    expect(pairRemote).toHaveBeenCalled()
    await click(button('Off'))
    expect(phone).toHaveBeenLastCalledWith(false)
    expect(await seriousViolations()).toEqual([])
  })

  it('says what is missing and offers the one step', async () => {
    install(status({ enabled: true, running: true, tunnel: 'tailscale', tunnelStatus: { ...OFF, state: 'no-tailscale' } }))
    await render(<McpSettings />)
    await settle()
    expect(text()).toContain('One thing is missing: Tailscale')
    await click(button('Get Tailscale'))
    expect(openExternal).toHaveBeenCalledWith('https://tailscale.com/download')
    await click(button('Try again'))
    expect(phone).toHaveBeenCalledWith(true)
    await cleanup()

    install(
      status({
        enabled: true,
        running: true,
        tunnel: 'tailscale',
        tunnelStatus: {
          state: 'needs-approval',
          address: 'https://erik-pc.tail1234.ts.net',
          approveUrl: 'https://login.tailscale.com/f/funnel?node=abc'
        }
      })
    )
    await render(<McpSettings />)
    await settle()
    await click(button('Allow in Tailscale'))
    expect(openExternal).toHaveBeenCalledWith('https://login.tailscale.com/f/funnel?node=abc')
  })
})
