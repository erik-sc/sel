/**
 * What Settings → MCP says about the endpoint and the calls made through it.
 *
 * Pure: no React, no `window.api`. Unit-tested.
 */
import type { McpStatus } from '../../../shared/mcp'

/** The tools as the list of calls names them. */
export const TOOL_LABELS: Record<string, string> = {
  search: 'Search',
  outline: 'Outline',
  read_page: 'Read a page',
  read_database: 'Read a database',
  recent: 'Recent pages',
  audit: 'Workspace check',
  create_page: 'Create a page',
  append_to_page: 'Add to a page',
  add_database_row: 'Add a row',
  update_database_row: 'Change a row',
  unknown: 'Unknown tool'
}

/** The line under "Token": whether other apps can connect now. */
export function stateLine(status: McpStatus | null): { text: string; error: boolean } {
  if (!status) return { text: '', error: false }
  if (!status.enabled) return { text: 'Off: no app can connect.', error: false }
  if (status.error) return { text: status.error, error: true }
  if (!status.running) return { text: 'Opening…', error: false }
  return { text: 'On: apps set up below can connect while sel is open.', error: false }
}

/** When a call was made: the time today, the day and time before. */
export function callTime(at: number, now: Date = new Date(), locale?: string): string {
  const when = new Date(at)
  const time = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return when.toDateString() === now.toDateString()
    ? time
    : `${when.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`
}
