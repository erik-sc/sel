import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where the bundled server script of the workspace tools is: next to the main bundle, which is
 * the folder of the code that asks or, when that code was split into a chunk of its own, the
 * folder above. On its own so that Settings can name the script without loading the tools.
 */
export function toolScript(dir: string, exists: (path: string) => boolean = existsSync): string {
  const candidates = [join(dir, 'mcp.js'), join(dir, '..', 'mcp.js')]
  return candidates.find((path) => exists(path)) ?? candidates[0]
}
