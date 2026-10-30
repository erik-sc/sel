import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
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
 * Kept next to the database, never in it (the database is synced and exported): remote-auth.json,
 * the registered apps, the owner's GitHub account and the grants, tokens as SHA-256 only.
 */

const AUTH_FILE = 'remote-auth.json'

export interface RemoteHooks {
  status(): RemoteStatus
  configure(raw: unknown): Promise<RemoteStatus>
  revoke(raw: unknown): Promise<RemoteStatus>
  pair(): Promise<RemoteStatus>
}

export function registerRemote({ repo, ready, changed }: { repo: Repository; ready: Promise<void>; changed(): void }): RemoteHooks {
  const userData = app.getPath('userData')
  const authFile = join(userData, AUTH_FILE)
  const config = (): RemoteConfig => cleanRemoteConfig(repo.getSetting(REMOTE_CONFIG_KEY))

  let loaded: { server: RemoteServer; auth: AuthStore } | null = null
  let loading: Promise<{ server: RemoteServer; auth: AuthStore }> | null = null
  let failure: string | null = null
  const load = (): Promise<{ server: RemoteServer; auth: AuthStore }> =>
    (loading ??= import('./service')
      .then(({ createRemoteServer }) =>
        createRemoteServer(repo, {
          config,
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
          const opening = !server.running
          await server.start(wanted.port)
          // Just turned on: the first app may connect for the next minutes without another click.
          if (opening && loaded && !loaded.auth.list().length) loaded.auth.openPairing()
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
    // Without a public address: this computer's, for Claude Code here (the phone needs the tunnel).
    const mcpUrl = `${current.publicUrl || `http://127.0.0.1:${current.port}`}/mcp`
    return {
      ...current,
      running: loaded?.server.running ?? false,
      error: loaded?.server.error ?? failure,
      owner: loaded?.auth.ownerLogin ?? null,
      mcpUrl,
      claudeCode: `claude mcp add --transport http --scope user sel-remote ${mcpUrl}`,
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
