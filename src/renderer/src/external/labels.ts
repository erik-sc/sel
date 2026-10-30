/**
 * What Settings → MCP says about the endpoint and the calls made through it.
 *
 * Pure: no React, no `window.api`. Unit-tested.
 */
import type { McpStatus, RemoteScope, RemoteStatus } from '../../../shared/mcp'

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
  list_tasks: 'List tasks',
  add_task: 'Add a task',
  complete_task: 'Complete a task',
  reschedule_task: 'Reschedule a task',
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

/** The line under "Remote connector": whether Claude can reach sel from anywhere now, or what is missing. */
export function remoteLine(status: RemoteStatus): { text: string; error: boolean } {
  if (!status.enabled) return { text: 'Off: nothing listens. Claude elsewhere cannot reach your notes.', error: false }
  if (status.error) return { text: status.error, error: true }
  if (!status.running) return { text: 'Starting…', error: false }
  const missing = [
    !status.publicUrl && 'the public address',
    !status.githubLogin && 'your GitHub account',
    !status.githubClientId && 'the GitHub client id',
    !status.hasSecret && 'the GitHub client secret'
  ].filter(Boolean)
  if (missing.length) return { text: `Listening on port ${status.port}, but still needs ${missing.join(', ')}.`, error: true }
  return { text: `On: listening on port ${status.port} for ${status.publicUrl}.`, error: false }
}

const SCOPE_WORDS: Record<RemoteScope, string> = { read: 'reads', tasks: 'manages tasks', write: 'writes pages' }

/** What a grant may do, in words: "reads, manages tasks". */
export function scopeWords(scopes: readonly RemoteScope[]): string {
  return scopes.map((scope) => SCOPE_WORDS[scope]).join(', ') || 'nothing'
}
