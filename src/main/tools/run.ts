import { callTool, listTrash, repositorySource, ToolError } from '../ai/tools'
import { callWriteTool } from '../ai/writes'
import type { Repository } from '../db/repository'
import { callFinanceTool } from '../finance/tools'
import { callTaskTool } from '../tasks/tools'
import { PACK_OF, type PackId } from './catalog'

/**
 * Runs the tools of every block (./catalog.ts) on the workspace, for the endpoint of the apps on
 * this computer (../external) and the remote connector (../remote). Which tools a caller may use
 * is theirs to check first; this only runs them.
 */

type Markdown = Pick<typeof import('../markdown'), 'pageToMarkdown' | 'importMarkdownText' | 'appendMarkdownText'>

/** Runs one tool of a block. Throws a ToolError, or an Error whose message may be shown. */
type Runner = (name: string, args: unknown) => string

export function createToolRunner(repo: Repository, markdown: Markdown): Runner {
  const source = repositorySource(repo, markdown)
  const reads = new Set(['search', 'outline', 'read_page', 'read_database', 'recent', 'audit'])
  // One runner a block: a pack in the catalog without one here does not typecheck.
  const runners: Record<PackId, Runner> = {
    tasks: (name, args) => callTaskTool(repo, name, args),
    workspace: (name, args) =>
      name === 'list_trash'
        ? listTrash(repo, args)
        : reads.has(name)
          ? callTool(source, name, args)
          : callWriteTool({ repo, markdown }, name, args),
    finance: (name, args) => callFinanceTool({ repo, markdown }, name, args)
  }
  return (name, args) => {
    const pack = PACK_OF.get(name)
    if (!pack) throw new ToolError(`There is no tool called ${String(name).slice(0, 40)}.`)
    return runners[pack](name, args)
  }
}
