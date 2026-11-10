import type { Repository } from '../db/repository'
import { toolsFor } from '../tools/catalog'
import { createToolRunner } from '../tools/run'
import { AuthStore } from './auth'
import { RemoteServer, type RemoteServerOptions } from './server'

/**
 * The remote connector wired to the workspace. Which tools a grant gets follows what the user
 * allowed on the consent screen, by the scope each block gives its tools (../tools/catalog.ts):
 *   read    → the task lists and the reading tools (search, outline, read_page, the trash…)
 *   tasks   → add, complete, change, reopen and delete tasks
 *   write   → create, rewrite, move and delete pages, databases and rows
 *   finance → read and write the Finance block
 * Loaded the first time the user turns it on, or when sel starts with it on.
 */

export { toolsFor }

export async function createRemoteServer(
  repo: Repository,
  options: Omit<RemoteServerOptions, 'run' | 'tools' | 'auth'> & { load(): string | null; save(text: string): void }
): Promise<{ server: RemoteServer; auth: AuthStore }> {
  const markdown = await import('../markdown')
  const auth = new AuthStore({ load: options.load, save: options.save, now: options.now })
  const server = new RemoteServer({
    ...options,
    auth,
    tools: toolsFor,
    run: createToolRunner(repo, markdown)
  })
  return { server, auth }
}
