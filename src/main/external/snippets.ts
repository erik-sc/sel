import { TOOL_SERVER } from '../ai/toolspecs'

const quote = (text: string): string => `"${text}"`

/**
 * How a client starts sel's MCP server, as Settings shows it: this executable run as Node
 * (`ELECTRON_RUN_AS_NODE=1`), the bundled script, and where the discovery file is. The
 * `claude mcp add` command for Claude Code, and the `mcpServers` entry for Claude Desktop.
 */
export function connectSnippets(execPath: string, script: string, discovery: string): { claudeCode: string; claudeDesktop: string } {
  const args = [script, '--discovery', discovery]
  return {
    claudeCode: `claude mcp add --scope user --env ELECTRON_RUN_AS_NODE=1 ${TOOL_SERVER} -- ${quote(execPath)} ${quote(script)} --discovery ${quote(discovery)}`,
    claudeDesktop: JSON.stringify(
      { mcpServers: { [TOOL_SERVER]: { command: execPath, args, env: { ELECTRON_RUN_AS_NODE: '1' } } } },
      null,
      2
    )
  }
}
