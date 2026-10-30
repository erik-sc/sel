import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { MCP_ENABLED_KEY, type McpStatus } from '../../shared/mcp'
import { toolScript } from '../ai/toolscript'
import type { Repository } from '../db/repository'
import type { Handlers } from '../invoke'
import type { ExternalEndpoint } from './endpoint'
import { DISCOVERY_FILE } from './protocol'
import { connectSnippets } from './snippets'
import { defineFeature, type Registered } from '../feature'
import { registerRemote } from '../remote/register'

/**
 * The `mcp:*` channels and the endpoint other apps connect to (see ./endpoint.ts). Nothing of
 * the endpoint is loaded, and no pipe is opened, until the user turns "Connect other apps" on.
 * Turning it off closes the endpoint and removes the discovery file; the token is kept, sealed
 * with the system's protection for this user (safeStorage), so the apps set up keep working when
 * it is turned on again.
 */

export interface ExternalHooks {
  handlers: Handlers<'mcp'>
  /** `mcp.enabled` was written: open or close the endpoint. */
  settingChanged(): void
}

/** The token, sealed: next to the database, never in it (the database is synced and exported). */
const TOKEN_FILE = 'mcp-token.bin'

export function registerExternalIpc({ repo, ready, changed }: { repo: Repository; ready: Promise<void>; changed(): void }): ExternalHooks {
  const userData = app.getPath('userData')
  const tokenFile = join(userData, TOKEN_FILE)
  const discovery = join(userData, DISCOVERY_FILE)
  const snippets = connectSnippets(process.execPath, toolScript(__dirname), discovery)
  const sealable = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  let endpoint: ExternalEndpoint | null = null
  let loading: Promise<ExternalEndpoint> | null = null
  let failure: string | null = null
  const load = (): Promise<ExternalEndpoint> =>
    (loading ??= import('./service')
      .then(({ createEndpoint }) =>
        createEndpoint(repo, {
          userData,
          // Without the system's protection the token lives in memory only: a new one each time sel starts.
          loadToken: () => (sealable() ? safeStorage.decryptString(readFileSync(tokenFile)) : null),
          saveToken: (token) => {
            if (sealable()) writeFileSync(tokenFile, safeStorage.encryptString(token), { mode: 0o600 })
            else rmSync(tokenFile, { force: true })
          },
          changed
        })
      )
      .then((made) => (endpoint = made))
      .catch((err: unknown) => {
        loading = null
        throw err
      }))

  const enabled = (): boolean => repo.getSetting(MCP_ENABLED_KEY) === true

  // Turning on and off, and new tokens, one after the other.
  let queue: Promise<void> = Promise.resolve()
  const enqueue = (step: () => Promise<void>): Promise<void> => {
    const run = queue.then(step)
    queue = run.catch(() => undefined)
    return run
  }

  const follow = (): Promise<void> =>
    enqueue(async () => {
      try {
        if (enabled()) {
          failure = null
          await (await load()).start()
        } else {
          failure = null
          if (endpoint) await endpoint.stop(true)
          // Left behind by a run that ended without closing: nothing listens there now.
          else rmSync(discovery, { force: true })
        }
      } catch (err) {
        failure = 'The connection for other apps could not be opened.'
        console.error('[mcp] the endpoint could not follow the setting', err)
      }
    })

  const status = (): McpStatus => ({
    enabled: enabled(),
    running: endpoint?.running ?? false,
    error: endpoint?.error ?? failure,
    persistent: sealable(),
    ...snippets,
    calls: endpoint?.calls ?? []
  })

  const remote = registerRemote({ repo, ready, changed })

  void ready.then(follow)
  // The pipe closes with the app; the discovery file stays, and the clients say sel is not open.
  app.on('will-quit', () => void endpoint?.stop(false))

  return {
    handlers: {
      'mcp:status': () => status(),
      'mcp:rotateToken': async () => {
        await enqueue(async () => (await load()).rotate())
        return status()
      },
      'mcp:remoteStatus': () => remote.status(),
      'mcp:configureRemote': ([input]) => remote.configure(input),
      'mcp:revokeRemote': ([id]) => remote.revoke(id),
      'mcp:pairRemote': () => remote.pair()
    },
    settingChanged: () => void follow()
  }
}

/**
 * Other apps connected to the notes over MCP, when the user turned that on. Off by default: until
 * then no pipe is opened. What a connected app writes reaches the windows from the origin `mcp`.
 */
export const mcpFeature = defineFeature({
  namespace: 'mcp',
  register: (ctx): Registered<'mcp'> => {
    const hooks = registerExternalIpc({ repo: ctx.repo, ready: ctx.ready, changed: () => ctx.changes('mcp') })
    return {
      handlers: hooks.handlers,
      // Other apps were let in or shut out: the endpoint for them opens or closes.
      onSettingChanged: (key) => {
        if (key.startsWith('mcp.')) hooks.settingChanged()
      }
    }
  }
})
