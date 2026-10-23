/**
 * Context per project and per database (0.8.0 A4): beside what the user wrote for every request
 * (Settings → AI → Context, ./aiContext.ts), each project of Tasks and each database may carry a
 * short text and up to three pinned pages of its own. It goes along only with a request made from
 * something that belongs there.
 *
 * Stored on the blocks, so it syncs and is exported with them (unlike the general context, which
 * stays on the device):
 * - a project (an option of the Tasks database's `tasks.project`): `props.projects[optionId].context`
 *   on the Tasks database, beside the project's plan (./tasks/projects.ts keeps it when the plan
 *   changes);
 * - a database: `props.aiContext` on the database block.
 * Both have the shape `{ text, pages }`.
 *
 * What "belongs" means, decided here for every reader (`contextScopes`): walking up from the page a
 * request is about, the first row of the Tasks database met gives the project (its `tasks.project`; any database with that
 * property counts, as for ./aiPrivate.ts),
 * and the first database met (the page itself when it is one, or the database a row sits in) gives
 * the database. A page inside a task belongs to the task's project; a page that only links to a task
 * or mentions a project does not (there is no link from a page to a project in sel). So at most one
 * project and one database go along.
 *
 * Never for what is private from the AI (./aiPrivate.ts): a private database, a private project or
 * a page inside either gives no scope, and the pinned pages are checked again where they are read.
 *
 * Pure: no Electron, Node or React.
 */
import { AI_CONTEXT_CAPS, contextPageIds } from './aiContext'
import { privacyChecker, privateProjects, type PrivacyLookup } from './aiPrivate'
import { isPlainObject, optionsOf, propOf, titleOf } from './database/values'
import { TASK_PROPS, TASKS_DATABASE_ID } from './tasks'
import type { Block } from './types'

export const SCOPE_CONTEXT_CAPS = {
  /** Characters of the written text: the same as the general context. */
  text: AI_CONTEXT_CAPS.text,
  /** Pages pinned to one project or database. */
  pages: 3,
  /** Characters of one of those pages in a prompt; a longer one keeps its start and its end. */
  pageChars: 6000,
  /** Characters of all the pinned pages of one scope together in a prompt. */
  pagesTotal: 12_000,
  /** Characters of the project's or database's name as the prompt says it. */
  name: 120
} as const

/** A project's or database's own context, as stored. */
export interface ScopeContext {
  text: string
  /** Pinned page ids, in the order they were pinned. */
  pages: string[]
}

export type ScopeKind = 'project' | 'database'

/** One project or database whose context a request carries. */
export interface ContextScope {
  kind: ScopeKind
  /** The project's option id, or the database's block id. */
  id: string
  /** The database that holds it (for a database, its own id). */
  databaseId: string
  /** The project's or database's name. */
  name: string
  context: ScopeContext
}

/** The context as stored, cleaned; null when it says nothing (no text, no page). */
export function readScopeContext(raw: unknown): ScopeContext | null {
  if (!isPlainObject(raw)) return null
  const text = typeof raw.text === 'string' ? raw.text.slice(0, SCOPE_CONTEXT_CAPS.text) : ''
  const pages = contextPageIds(raw.pages).slice(0, SCOPE_CONTEXT_CAPS.pages)
  if (!text.trim() && !pages.length) return null
  return { text: text.trim() ? text : '', pages }
}

/** What to store for a context: the cleaned value, or null to remove it. */
export function storedScopeContext(context: Partial<ScopeContext> | null | undefined): ScopeContext | null {
  return readScopeContext(context ?? null)
}

/** A database's own context (`props.aiContext`). */
export function databaseContextOf(database: Pick<Block, 'props'> | null | undefined): ScopeContext | null {
  return readScopeContext(database?.props.aiContext)
}

/** A project's context, from the Tasks database's `props.projects`. */
export function projectContextOf(tasksDatabase: Pick<Block, 'props'> | null | undefined, projectId: string): ScopeContext | null {
  const plans: unknown = tasksDatabase?.props.projects
  if (!isPlainObject(plans) || !Object.hasOwn(plans, projectId)) return null
  const plan = plans[projectId]
  return isPlainObject(plan) ? readScopeContext(plan.context) : null
}

/** The name of a project (its option's name), or '' when the option is gone. */
export function projectName(tasksDatabase: Pick<Block, 'props'> | null | undefined, projectId: string): string {
  const schema = isPlainObject(tasksDatabase?.props.schema) ? tasksDatabase.props.schema : undefined
  return optionsOf(propOf(schema, TASK_PROPS.project)).find((option) => option?.id === projectId)?.name ?? ''
}

/** Whether a database has the Project property of Tasks. */
function hasProjects(database: Block): boolean {
  return database.id === TASKS_DATABASE_ID || propOf(database.props.schema, TASK_PROPS.project) !== undefined
}

/** Whether a project still exists as an option of the Tasks database. */
function projectExists(tasksDatabase: Block, projectId: string): boolean {
  const schema = isPlainObject(tasksDatabase.props.schema) ? tasksDatabase.props.schema : undefined
  return optionsOf(propOf(schema, TASK_PROPS.project)).some((option) => option?.id === projectId)
}

const MAX_DEPTH = 64

/**
 * The project and database whose context goes along with a request about `pageId` (see the top
 * of this file): the project first, then the database; empty when none has a context, or when it
 * or the page is private from the AI. `hidden` may be passed to share one privacy checker.
 */
export function contextScopes(
  source: PrivacyLookup,
  pageId: string | null | undefined,
  hidden: (id: string | null | undefined) => boolean = privacyChecker(source)
): ContextScope[] {
  if (!pageId || hidden(pageId)) return []
  let project: ContextScope | null = null
  let database: ContextScope | null = null
  let projectSeen = false
  let databaseSeen = false
  let current = source.get(pageId) ?? null
  for (let depth = 0; current && depth < MAX_DEPTH && !(projectSeen && databaseSeen); depth++) {
    const parent = current.parentId ? (source.get(current.parentId) ?? null) : null
    // The page itself, when it is a database (a linked view stands for its source).
    if (!databaseSeen && current.type === 'database') {
      databaseSeen = true
      const sourceId = typeof current.props.sourceId === 'string' ? current.props.sourceId : null
      const own = sourceId ? (source.get(sourceId) ?? null) : current
      database = own ? databaseScope(own, hidden) : null
    }
    // A row: the database it sits in, and, in Tasks, its project.
    if (current.type === 'page' && parent && parent.type === 'database' && !parent.trashedAt) {
      if (!databaseSeen) {
        databaseSeen = true
        database = databaseScope(parent, hidden)
      }
      // The Tasks database (or any with its Project property, as aiPrivate.ts reads them too).
      if (!projectSeen && hasProjects(parent)) {
        const value = current.props.values?.[TASK_PROPS.project]
        if (typeof value === 'string' && value) {
          projectSeen = true
          project = projectScope(parent, value, hidden)
        }
      }
    }
    current = parent
  }
  return [project, database].filter((scope): scope is ContextScope => scope !== null)
}

function databaseScope(database: Block, hidden: (id: string) => boolean): ContextScope | null {
  if (database.type !== 'database' || database.trashedAt || hidden(database.id)) return null
  const context = databaseContextOf(database)
  if (!context) return null
  return { kind: 'database', id: database.id, databaseId: database.id, name: oneLine(titleOf(database)), context }
}

function projectScope(tasks: Block, projectId: string, hidden: (id: string) => boolean): ContextScope | null {
  if (hidden(tasks.id) || privateProjects(tasks).includes(projectId) || !projectExists(tasks, projectId)) return null
  const context = projectContextOf(tasks, projectId)
  if (!context) return null
  return { kind: 'project', id: projectId, databaseId: tasks.id, name: oneLine(projectName(tasks, projectId)), context }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, SCOPE_CONTEXT_CAPS.name)
}

/**
 * Every project and database that has a context of its own, for Settings → AI → Context (a list
 * that leads to each). `databases` are the databases the window knows of; the Tasks database's
 * projects come first. A private one is listed, marked, since it is never sent.
 */
export function scopesWithContext(
  tasksDatabase: Block | null | undefined,
  databases: readonly Block[]
): { kind: ScopeKind; id: string; databaseId: string; name: string; context: ScopeContext }[] {
  const out: { kind: ScopeKind; id: string; databaseId: string; name: string; context: ScopeContext }[] = []
  if (tasksDatabase) {
    const schema = isPlainObject(tasksDatabase.props.schema) ? tasksDatabase.props.schema : undefined
    for (const option of optionsOf(propOf(schema, TASK_PROPS.project))) {
      const context = option?.id ? projectContextOf(tasksDatabase, option.id) : null
      if (context) out.push({ kind: 'project', id: option.id, databaseId: tasksDatabase.id, name: option.name, context })
    }
  }
  for (const database of databases) {
    if (database.type !== 'database' || database.trashedAt) continue
    const context = databaseContextOf(database)
    if (context) out.push({ kind: 'database', id: database.id, databaseId: database.id, name: titleOf(database), context })
  }
  return out
}
