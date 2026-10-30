import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { ALARMS_SETTING } from '../../shared/alarms'
import {
  cleanPublicUrl,
  cleanRemoteConfig,
  REMOTE_CONFIG_KEY,
  type RemoteConfig,
  type RemoteConfigInput,
  type RemoteStatus
} from '../../shared/mcp'
import type { Repository } from '../db/repository'
import * as arg from '../validate'
import type { AuthStore } from './auth'
import type { Fetch } from './github'
import type { RemoteServer } from './server'

/**
 * The remote connector's side of the `mcp` feature (see ./server.ts): its three channels, and
 * opening or closing the server as its setting says. Nothing of it is loaded, and no port is
 * opened, until the user turns it on.
 *
 * Kept next to the database, never in it (the database is synced and exported):
 *  - remote-github.bin: the GitHub client secret, sealed with the system's protection for this user;
 *  - remote-auth.json: registered apps and grants, tokens as SHA-256 only.
 */

const SECRET_FILE = 'remote-github.bin'
const AUTH_FILE = 'remote-auth.json'

export interface RemoteHooks {
  status(): RemoteStatus
  configure(raw: unknown): Promise<RemoteStatus>
  revoke(raw: unknown): Promise<RemoteStatus>
  pair(): Promise<RemoteStatus>
}

export function registerRemote({ repo, ready, changed }: { repo: Repository; ready: Promise<void>; changed(): void }): RemoteHooks {
  const userData = app.getPath('userData')
  const secretFile = join(userData, SECRET_FILE)
  const authFile = join(userData, AUTH_FILE)
  const sealable = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }
  const config = (): RemoteConfig => cleanRemoteConfig(repo.getSetting(REMOTE_CONFIG_KEY))
  let cachedSecret: string | null | undefined
  const secret = (): string | null => {
    if (cachedSecret !== undefined) return cachedSecret
    try {
      cachedSecret = sealable() ? safeStorage.decryptString(readFileSync(secretFile)) || null : null
    } catch {
      cachedSecret = null
    }
    return cachedSecret
  }

  let loaded: { server: RemoteServer; auth: AuthStore } | null = null
  let loading: Promise<{ server: RemoteServer; auth: AuthStore }> | null = null
  let failure: string | null = null
  const load = (): Promise<{ server: RemoteServer; auth: AuthStore }> =>
    (loading ??= import('./service')
      .then(({ createRemoteServer }) =>
        createRemoteServer(repo, {
          config,
          secret,
          changed,
          fetch: globalThis.fetch as unknown as Fetch,
          load: () => {
            try {
              return readFileSync(authFile, 'utf8')
            } catch {
              return null
            }
          },
          // Whole or not at all: a new file, then moved over the old one.
          save: (text) => {
            const temporary = `${authFile}.tmp`
            rmSync(temporary, { force: true })
            writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600 })
            renameSync(temporary, authFile)
          }
        })
      )
      .then((made) => (loaded = made))
      .catch((err: unknown) => {
        loading = null
        throw err
      }))

  let queue: Promise<void> = Promise.resolve()
  const enqueue = (step: () => Promise<void>): Promise<void> => {
    const run = queue.then(step)
    queue = run.catch(() => undefined)
    return run
  }

  /** Opens or closes the server as the setting says; a new port means a restart. */
  const follow = (): Promise<void> =>
    enqueue(async () => {
      const wanted = config()
      try {
        failure = null
        if (wanted.enabled) {
          const { server } = await load()
          if (server.running && server.port !== wanted.port) await server.stop()
          await server.start(wanted.port)
        } else if (loaded) {
          loaded.auth.closePairing()
          await loaded.server.stop()
        }
      } catch (err) {
        failure = loaded?.server.error ?? 'The remote connector could not be started.'
        console.error('[remote] the server could not follow the setting', err)
      }
    })

  const status = (): RemoteStatus => {
    const current = config()
    const base = current.publicUrl
    const mcpUrl = base ? `${base}/mcp` : ''
    return {
      ...current,
      running: loaded?.server.running ?? false,
      error: loaded?.server.error ?? failure,
      hasSecret: secret() !== null,
      mcpUrl,
      githubCallback: `${base || `http://127.0.0.1:${current.port}`}/oauth/callback`,
      claudeCode: mcpUrl ? `claude mcp add --transport http --scope user sel ${mcpUrl}` : '',
      grants: loaded?.auth.list() ?? [],
      calls: loaded?.server.calls ?? [],
      pairingUntil: loaded?.server.running ? loaded.auth.pairingUntil : null,
      staysRunning: repo.getSetting(ALARMS_SETTING.tray) === true
    }
  }

  void ready.then(follow)
  app.on('will-quit', () => void loaded?.server.stop())

  return {
    status,
    configure: async (raw) => {
      const input = arg.plainObject(raw, 'remote settings') as Partial<RemoteConfigInput>
      if (input.publicUrl !== undefined && cleanPublicUrl(input.publicUrl) === null)
        throw new Error('The public address must be an https address, such as https://my-pc.tail1234.ts.net.')
      const next = cleanRemoteConfig({ ...config(), ...input })
      const typed = typeof input.githubSecret === 'string' ? input.githubSecret.trim() : ''
      if (typed) {
        if (!/^[A-Za-z0-9._-]{8,200}$/u.test(typed)) throw new Error('That does not look like a GitHub client secret.')
        if (!sealable()) throw new Error('This computer cannot keep the secret sealed, so sel cannot store it.')
        writeFileSync(secretFile, safeStorage.encryptString(typed), { mode: 0o600 })
        cachedSecret = typed
      }
      repo.setSetting(REMOTE_CONFIG_KEY, next)
      await follow()
      return status()
    },
    revoke: async (raw) => {
      const id = raw === undefined || raw === null ? undefined : arg.id(raw, 'authorization')
      const { auth } = await load()
      auth.revoke(id)
      return status()
    },
    pair: async () => {
      const { server, auth } = await load()
      if (!server.running) throw new Error('Turn the remote connector on first.')
      auth.openPairing()
      return status()
    }
  }
}
