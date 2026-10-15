import type { Repository } from '../db/repository'
import { callTool, repositorySource } from '../ai/tools'
import { WRITE_TOOL_NAMES } from '../ai/toolspecs'
import { callWriteTool } from '../ai/writes'
import { ExternalEndpoint, type EndpointOptions } from './endpoint'

/**
 * The endpoint for other apps, wired to the workspace: the reading tools Herman has, and the
 * writing ones only connected apps get. Loaded (with the Markdown converter the tools read and
 * write pages with) the first time the user turns "Connect other apps" on, or when sel starts
 * with it on.
 */
export async function createEndpoint(
  repo: Repository,
  options: Omit<EndpointOptions, 'run'>
): Promise<ExternalEndpoint> {
  const markdown = await import('../markdown')
  const source = repositorySource(repo, markdown)
  const writes = new Set(WRITE_TOOL_NAMES)
  return new ExternalEndpoint({
    ...options,
    run: (name, args) => (writes.has(name) ? callWriteTool({ repo, markdown }, name, args) : callTool(source, name, args))
  })
}
