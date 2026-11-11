import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { TunnelStatus } from '../../shared/mcp'

/**
 * The tunnel sel opens by itself for "Claude on your phone": Tailscale Funnel, which gives this
 * computer a public https address with nothing to buy or configure (see docs/remote-mcp.md). sel
 * finds the `tailscale` program, asks it for this computer's address, and points its Funnel at
 * the remote connector's port; Tailscale keeps that across restarts, and sel asks again each time
 * it starts, so the address is always the one in use.
 *
 * The program is started without a shell, by absolute path, with a minimal environment, and only
 * with the arguments written here. Everything it prints is read as data.
 */

export interface RunResult {
  /** The exit code, or null when it was stopped for taking too long. */
  code: number | null
  /** What it printed, both streams together. */
  out: string
}

export type Runner = (args: readonly string[], timeoutMs: number) => Promise<RunResult>

const OFF: TunnelStatus = { state: 'off', address: '', approveUrl: null }

/** Where the `tailscale` program is, or null: its usual folder on Windows, then the folders of PATH. */
export function findTailscale(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string | null {
  // The rules of the platform asked about, not of the one this runs on.
  const { delimiter, isAbsolute, join } = platform === 'win32' ? win32 : posix
  const name = platform === 'win32' ? 'tailscale.exe' : 'tailscale'
  const candidates: string[] = []
  if (platform === 'win32') {
    for (const root of [env['ProgramFiles'], env['ProgramW6432'], 'C:\\Program Files'])
      if (root) candidates.push(join(root, 'Tailscale', name))
  } else if (platform === 'darwin') {
    candidates.push('/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale')
  } else candidates.push('/usr/bin/tailscale', '/usr/local/bin/tailscale')
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
  // Absolute folders only: a relative entry would let the current folder decide what runs.
  for (const folder of path.split(delimiter)) if (folder && isAbsolute(folder)) candidates.push(join(folder, name))
  return candidates.find((candidate) => exists(candidate)) ?? null
}

/** Starts the program at `path`: no shell, a minimal environment, stopped when it takes too long. */
export function spawnRunner(path: string): Runner {
  return (args, timeoutMs) =>
    new Promise((resolve) => {
      let out = ''
      let done = false
      const finish = (code: number | null): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({ code, out })
      }
      const env: NodeJS.ProcessEnv = {}
      for (const key of ['SystemRoot', 'windir', 'ProgramData', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'])
        if (process.env[key]) env[key] = process.env[key]
      const child = spawn(path, [...args], { shell: false, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
      const timer = setTimeout(() => {
        child.kill()
        finish(null)
      }, timeoutMs)
      const read = (chunk: Buffer): void => {
        if (out.length < 200_000) out += chunk.toString('utf8')
      }
      child.stdout?.on('data', read)
      child.stderr?.on('data', read)
      child.on('error', () => finish(null))
      child.on('close', (code) => finish(code))
    })
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

function json(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  try {
    return record(JSON.parse(text.slice(start)))
  } catch {
    return null
  }
}

/** This computer's public address from `tailscale status --json`, or null when Tailscale is not signed in and running. */
export function addressOf(statusJson: string): string | null {
  const status = json(statusJson)
  if (!status || status['BackendState'] !== 'Running') return null
  const name = record(status['Self'])?.['DNSName']
  if (typeof name !== 'string') return null
  const host = name.replace(/\.$/u, '').toLowerCase()
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/u.test(host) ? `https://${host}` : null
}

/** Whether `tailscale funnel status --json` says the internet reaches `port` of this computer on 443. */
export function funnelReaches(configJson: string, port: number): boolean {
  const config = json(configJson)
  const allowed = record(config?.['AllowFunnel'])
  const web = record(config?.['Web'])
  if (!allowed || !web) return false
  for (const [hostPort, on] of Object.entries(allowed)) {
    if (on !== true || !hostPort.endsWith(':443')) continue
    const handlers = record(record(web[hostPort])?.['Handlers'])
    const proxy = record(handlers?.['/'])?.['Proxy']
    if (typeof proxy === 'string' && new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${port}/?$`, 'u').test(proxy)) return true
  }
  return false
}

/** The page Tailscale asks the user to open, once, to allow Funnel for this computer. */
export function approvalUrl(output: string): string | null {
  const found = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/u.exec(output)?.[0]
  if (!found) return null
  try {
    const url = new URL(found)
    return url.hostname === 'login.tailscale.com' ? url.toString() : null
  } catch {
    return null
  }
}

/** Opens the tunnel to `port`. Says where it stands, in terms the settings can act on; never throws. */
export async function openTunnel(run: Runner | null, port: number): Promise<TunnelStatus> {
  if (!run) return { ...OFF, state: 'no-tailscale' }
  const status = await run(['status', '--json'], 10_000)
  const address = addressOf(status.out)
  if (!address) return { ...OFF, state: 'signed-out' }
  const opened = await run(['funnel', '--bg', '--https=443', `http://127.0.0.1:${port}`], 20_000)
  const config = await run(['funnel', 'status', '--json'], 10_000)
  if (funnelReaches(config.out, port)) return { state: 'on', address, approveUrl: null }
  // Not allowed yet: Tailscale prints the page where the user allows it, and waits.
  const approveUrl = approvalUrl(opened.out)
  if (approveUrl) return { state: 'needs-approval', address, approveUrl }
  // An older Tailscale may not print the configuration as JSON: its own word is enough.
  if (opened.code === 0 && !json(config.out)) return { state: 'on', address, approveUrl: null }
  return { state: 'failed', address, approveUrl: null }
}

/** Closes the tunnel sel opened. */
export async function closeTunnel(run: Runner | null): Promise<void> {
  if (run) await run(['funnel', '--https=443', 'off'], 10_000)
}
