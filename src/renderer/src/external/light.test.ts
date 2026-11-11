import { describe, expect, it } from 'vitest'
import { DEFAULT_REMOTE_CONFIG, type McpStatus, type RemoteStatus } from '../../../shared/mcp'
import { mcpLight } from './light'

const remote = (over: Partial<RemoteStatus> = {}): RemoteStatus => ({
  ...DEFAULT_REMOTE_CONFIG,
  running: false,
  error: null,
  owner: null,
  mcpUrl: 'http://127.0.0.1:47615/mcp',
  claudeCode: '',
  grants: [],
  calls: [],
  pairingUntil: null,
  staysRunning: true,
  tunnelStatus: { state: 'off', address: '', approveUrl: null },
  ...over
})

const local = (over: Partial<McpStatus> = {}): McpStatus => ({
  enabled: false,
  running: false,
  error: null,
  persistent: true,
  claudeCode: '',
  claudeDesktop: '',
  calls: [],
  ...over
})

const ADDRESS = 'https://erik-pc.tail1234.ts.net'
const reached = (over: Partial<RemoteStatus> = {}): RemoteStatus =>
  remote({
    enabled: true,
    tunnel: 'tailscale',
    running: true,
    publicUrl: ADDRESS,
    mcpUrl: `${ADDRESS}/mcp`,
    tunnelStatus: { state: 'on', address: ADDRESS, approveUrl: null },
    ...over
  })

describe('the MCP light', () => {
  it('is off when nothing is open, and before anything was read', () => {
    expect(mcpLight(null, null).state).toBe('off')
    expect(mcpLight(remote(), local()).state).toBe('off')
  })

  it('is on when Claude reaches sel from outside, with the address', () => {
    expect(mcpLight(reached(), local())).toEqual({ state: 'on', detail: `${ADDRESS}/mcp` })
    // An address typed by hand counts as well.
    expect(mcpLight(reached({ tunnel: 'manual', tunnelStatus: { state: 'off', address: '', approveUrl: null } }), local()).state).toBe('on')
  })

  it('says so when only this computer reaches it', () => {
    expect(mcpLight(remote(), local({ enabled: true, running: true })).state).toBe('local')
    expect(mcpLight(remote({ enabled: true, tunnel: 'manual', running: true }), local()).state).toBe('local')
  })

  it('asks for attention when it was turned on and something is in the way', () => {
    expect(mcpLight(reached({ running: false, error: 'The port is taken.' }), local())).toEqual({
      state: 'problem',
      detail: 'The port is taken.'
    })
    for (const state of ['no-tailscale', 'signed-out', 'needs-approval', 'failed'] as const)
      expect(mcpLight(reached({ tunnelStatus: { state, address: '', approveUrl: null } }), local()).state).toBe('problem')
    expect(mcpLight(remote(), local({ enabled: true, error: 'The pipe could not be opened.' })).state).toBe('problem')
  })

  it('is starting until the server listens', () => {
    expect(mcpLight(remote({ enabled: true, tunnel: 'manual' }), local()).state).toBe('starting')
  })
})
