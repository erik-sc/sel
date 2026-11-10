import type { RemoteScope } from '../../shared/mcp'
import { WORKSPACE_PACK, type ToolSpec } from '../ai/toolspecs'
import { FINANCE_PACK } from '../finance/toolspecs'
import { SPLIT_PACK } from '../split/toolspecs'
import { TASKS_PACK } from '../tasks/toolspecs'
import type { PackTool } from './pack'

/**
 * Every block's tools, the one list of them (see ./pack.ts). A block adds itself here, one line,
 * and its runner in ./run.ts, which fails to typecheck until it does. The order is the order
 * the tools are listed in.
 *
 * Plain data: the server script (../mcp.ts) bundles this file.
 */
export const PACKS = [TASKS_PACK, WORKSPACE_PACK, FINANCE_PACK, SPLIT_PACK] as const

export type PackId = (typeof PACKS)[number]['id']

export const EVERY_TOOL: readonly PackTool[] = PACKS.flatMap((pack) => pack.tools)

/** The pack a tool belongs to, by the tool's name. */
export const PACK_OF: ReadonlyMap<string, PackId> = new Map(
  PACKS.flatMap((pack) => pack.tools.map((tool) => [tool.spec.name, pack.id] as const))
)

/** What an app connected on this computer is offered: everything. */
export const EXTERNAL_TOOL_SPECS: readonly ToolSpec[] = EVERY_TOOL.map((tool) => tool.spec)

/** What a remote connection granted these scopes is offered. */
export function toolsFor(scopes: readonly RemoteScope[]): ToolSpec[] {
  return EVERY_TOOL.filter((tool) => scopes.includes(tool.scope)).map((tool) => tool.spec)
}

/** One line a block, for the servers' instructions. */
export const BLOCKS_SUMMARY = PACKS.map((pack) => `${pack.title}: ${pack.summary}`).join(' ')
