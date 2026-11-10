import type { Repository } from '../db/repository'
import { createToolRunner } from '../tools/run'
import { ExternalEndpoint, type EndpointOptions } from './endpoint'

/**
 * The endpoint for other apps, wired to the workspace: the tools of every block (../tools). Loaded (with the Markdown converter the tools read and
 * write pages with) the first time the user turns "Connect other apps" on, or when sel starts
 * with it on.
 */
export async function createEndpoint(repo: Repository, options: Omit<EndpointOptions, 'run'>): Promise<ExternalEndpoint> {
  const markdown = await import('../markdown')
  return new ExternalEndpoint({ ...options, run: createToolRunner(repo, markdown) })
}
