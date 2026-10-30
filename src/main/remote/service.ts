import type { RemoteScope } from '../../shared/mcp'
import { callTool, repositorySource } from '../ai/tools'
import { TOOL_SPECS, WRITE_TOOL_SPECS, type ToolSpec } from '../ai/toolspecs'
import { callWriteTool } from '../ai/writes'
import type { Repository } from '../db/repository'
import { AuthStore } from './auth'
import { RemoteServer, type RemoteServerOptions } from './server'
import { callTaskTool, TASK_READ_SPECS, TASK_TOOL_NAMES, TASK_WRITE_SPECS } from './tasks'

/**
 * The remote connector wired to the workspace. Which tools a grant gets follows what the user
 * allowed on the consent screen:
 *   read  → the task list and the reading tools Herman has (search, outline, read_page…)
 *   tasks → add, complete and reschedule tasks
 *   write → create pages, append, add and update database rows (as for apps on this computer)
 * Loaded the first time the user turns it on, or when sel starts with it on.
 */

const BY_SCOPE: Record<RemoteScope, readonly ToolSpec[]> = {
  read: [...TASK_READ_SPECS, ...TOOL_SPECS],
  tasks: TASK_WRITE_SPECS,
  write: WRITE_TOOL_SPECS
}

export function toolsFor(scopes: readonly RemoteScope[]): ToolSpec[] {
  return (['read', 'tasks', 'write'] as const).filter((scope) => scopes.includes(scope)).flatMap((scope) => BY_SCOPE[scope])
}

export async function createRemoteServer(
  repo: Repository,
  options: Omit<RemoteServerOptions, 'run' | 'tools' | 'auth'> & { load(): string | null; save(text: string): void }
): Promise<{ server: RemoteServer; auth: AuthStore }> {
  const markdown = await import('../markdown')
  const source = repositorySource(repo, markdown)
  const writes = new Set(WRITE_TOOL_SPECS.map((spec) => spec.name))
  const auth = new AuthStore({ load: options.load, save: options.save, now: options.now })
  const server = new RemoteServer({
    ...options,
    auth,
    tools: toolsFor,
    run: (name, args) => {
      if (TASK_TOOL_NAMES.has(name)) return callTaskTool(repo, name, args)
      if (writes.has(name)) return callWriteTool({ repo, markdown }, name, args)
      return callTool(source, name, args)
    }
  })
  return { server, auth }
}
