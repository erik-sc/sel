// A project's or database's own context for the AI (0.8.0 A4, shared/aiScope.ts): which one the
// editor is open on, and writing it. Kept on the blocks (the Tasks database's `props.projects`, a
// database's `props.aiContext`), so it syncs with them. Small and always loaded: the page menu
// and the project's head open the editor, which is a chunk of its own (ScopeContextDialog.tsx).
import { create } from 'zustand'
import { privateProjects } from '@shared/aiPrivate'
import {
  databaseContextOf,
  projectContextOf,
  projectName,
  SCOPE_CONTEXT_CAPS,
  storedScopeContext,
  type ScopeContext,
  type ScopeKind
} from '@shared/aiScope'
import { optionsOf, propOf, titleOf } from '@shared/database/values'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { withPlan } from '@shared/tasks/projects'
import type { Block } from '@shared/types'
import { applyOps, getBlock } from '@/store/blocks'
import { aiPrivacyNow, loadAncestors } from './privacy'

/** What the editor is open on: a project of Tasks (by option id) or a database (by block id). */
export interface ScopeTarget {
  kind: ScopeKind
  id: string
}

export const useScopeEditor = create<{ target: ScopeTarget | null }>(() => ({ target: null }))

export function openScopeContext(target: ScopeTarget): void {
  useScopeEditor.setState({ target })
}

export function closeScopeContext(): void {
  useScopeEditor.setState({ target: null })
}

/** The context stored now, read from the blocks in `get` (the window's store by default). */
export function scopeContextOf(target: ScopeTarget, get: (id: string) => Block | undefined | null = getBlock): ScopeContext | null {
  return target.kind === 'project' ? projectContextOf(get(TASKS_DATABASE_ID), target.id) : databaseContextOf(get(target.id))
}

/** The project's or database's name, for the editor's title. */
export function scopeName(target: ScopeTarget, get: (id: string) => Block | undefined | null = getBlock): string {
  const name = target.kind === 'project' ? projectName(get(TASKS_DATABASE_ID), target.id) : titleOf(get(target.id))
  return name.trim() || 'Untitled'
}

/** Stores the context (cleaned; an empty one is removed). */
export async function saveScopeContext(target: ScopeTarget, context: Partial<ScopeContext>): Promise<void> {
  const value = storedScopeContext(context)
  if (target.kind === 'database') {
    await applyOps([{ op: 'update', id: target.id, patch: { props: { aiContext: value } } }])
    return
  }
  const database = getBlock(TASKS_DATABASE_ID)
  if (!database) throw new Error('The Tasks database is not loaded.')
  // Beside the project's plan (shared/tasks/projects.ts), which keeps it when the plan changes.
  const known = optionsOf(propOf(database.props.schema, TASK_PROPS.project)).map((option) => option.id)
  const next = withPlan(database.props.projects, target.id, (plan) => ({ ...plan, context: value ?? undefined }), known)
  await applyOps([{ op: 'update', id: TASKS_DATABASE_ID, patch: { props: { projects: Object.keys(next).length ? next : null } } }])
}

/**
 * Whether a page may be pinned to a project or database: not when it is private from the AI
 * (itself or a page it is in, loaded first), nor when the list is full.
 */
export async function canPinToScope(pageId: string, pinned: readonly string[]): Promise<'ok' | 'private' | 'full'> {
  if (pinned.includes(pageId)) return 'ok'
  await loadAncestors(pageId)
  if (aiPrivacyNow(pageId)) return 'private'
  return pinned.length >= SCOPE_CONTEXT_CAPS.pages ? 'full' : 'ok'
}

/** Whether what the context belongs to is private from the AI: its context is then kept and never sent. */
export function scopePrivateNow(target: ScopeTarget): boolean {
  if (target.kind === 'database') return aiPrivacyNow(target.id) !== null
  const database = getBlock(TASKS_DATABASE_ID)
  if (!database) return false
  return aiPrivacyNow(TASKS_DATABASE_ID) !== null || privateProjects(database).includes(target.id)
}
