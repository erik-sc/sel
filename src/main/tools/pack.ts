import type { RemoteScope } from '../../shared/mcp'
import type { ToolSpec } from '../ai/toolspecs'

/**
 * A block's tools ("bloco", docs/codebase-knowledge/50-conventions.md, "Adicionar um bloco"): what
 * a part of sel offers over MCP, to the apps connected on this computer (../external) and to the
 * remote connector (../remote). A block declares its tools as plain data in its own
 * `toolspecs.ts`, runs them in its `tools.ts`, and joins the app with one line in ./catalog.ts
 * (the data) and one in ./run.ts (the code).
 *
 * Plain data and types only: the server script (../mcp.ts) bundles the catalog and nothing else
 * of the app.
 */

/** What a remote connection must have been granted for a tool to be offered to it (the consent screen lists them). */
export type ToolScope = RemoteScope

export interface PackTool {
  scope: ToolScope
  spec: ToolSpec
}

export interface ToolPack<Id extends string = string> {
  /** The block's id: the folder its code is in under src/main. */
  id: Id
  /** What the block is called, and what it is for, in one line each. */
  title: string
  summary: string
  tools: readonly PackTool[]
}

/** Keeps a pack's id a literal type, so ./run.ts can require a runner for every pack. */
export function definePack<const Id extends string>(pack: ToolPack<Id>): ToolPack<Id> {
  return pack
}

/** The tools of one scope, as pack entries. */
export const scoped = (scope: ToolScope, specs: readonly ToolSpec[]): PackTool[] => specs.map((spec) => ({ scope, spec }))
