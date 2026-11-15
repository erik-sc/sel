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
  skip_task: 'Skip a repeating task',
  reschedule_task: 'Reschedule a task',
  list_projects: 'List projects',
  update_task: 'Change a task',
  reopen_task: 'Reopen a task',
  delete_task: 'Delete a task',
  list_trash: 'List the trash',
  update_page: 'Change a page',
  move_page: 'Move a page',
  delete_page: 'Delete a page',
  restore_page: 'Restore from the trash',
  create_database: 'Create a database',
  add_database_property: 'Add a property',
  add_select_options: 'Add options',
  finance_month: 'Finances: the month',
  finance_entries: 'Finances: entries',
  finance_balances: 'Finances: who owes whom',
  finance_projection: 'Finances: projection',
  finance_review: 'Finances: review',
  finance_add: 'Finances: add an entry',
  finance_receipt: 'Finances: add a receipt',
  finance_update: 'Finances: change an entry',
  finance_delete: 'Finances: delete',
  finance_settle: 'Finances: settle up',
  finance_recurring: 'Finances: recurring line',
  finance_pay: 'Finances: pay a bill',
  finance_pay_invoice: 'Finances: pay an invoice',
  finance_budget: 'Finances: budget',
  finance_account: 'Finances: account',
  finance_box: 'Finances: box',
  split_summary: 'Shared bills: summary',
  split_config: 'Shared bills: set up',
  split_add: 'Shared bills: add an expense',
  split_bill: 'Shared bills: fixed bill',
  split_launch: 'Shared bills: launch a bill',
  split_settle: 'Shared bills: settle up',
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
  if (!status.publicUrl)
    return { text: `On, on this computer only (port ${status.port}). Add a public address for the phone.`, error: false }
  return { text: `On: listening on port ${status.port} for ${status.publicUrl}.`, error: false }
}

const SCOPE_WORDS: Record<RemoteScope, string> = {
  read: 'reads',
  tasks: 'manages tasks',
  write: 'writes pages',
  finance: 'manages finances'
}

/** What a grant may do, in words: "reads, manages tasks". */
export function scopeWords(scopes: readonly RemoteScope[]): string {
  return scopes.map((scope) => SCOPE_WORDS[scope]).join(', ') || 'nothing'
}
