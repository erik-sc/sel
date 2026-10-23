// "Private from AI" in the window: whether a page is (the lock in the sidebar and on the title),
// and the toggles of the page menu and of a Tasks project. The rule is shared/aiPrivate.ts; the
// main process enforces it on everything it hands to the AI and to connected apps, whatever the
// window shows. Small and always loaded: the sidebar draws the lock.
import { useEffect, useMemo } from 'react'
import { aiPrivacy, privateProjects, type AiPrivacy } from '@shared/aiPrivate'
import { TASKS_DATABASE_ID } from '@shared/tasks'
import { applyOps, fetchBlocks, getBlock, useBlockStore, watchSelector } from '@/store/blocks'

const samePrivacy = (a: AiPrivacy | null, b: AiPrivacy | null): boolean =>
  a === b || (!!a && !!b && a.reason === b.reason && a.fromId === b.fromId)

/** The window's blocks as the rule reads them. What is not loaded counts as not private (main still checks). */
const storeLookup = { get: (id: string) => getBlock(id) }

/** Why `id` is private from the AI, or null, from the blocks loaded now. */
export function aiPrivacyNow(id: string | null | undefined): AiPrivacy | null {
  return aiPrivacy(storeLookup, id)
}

/** Loads the pages above `id`, so that a mark on one of them shows. */
export function loadAncestors(id: string): Promise<unknown> {
  return fetchBlocks(() => window.api.pages.ancestors(id)).catch((error: unknown) =>
    console.error('ai: loading the pages above failed', error)
  )
}

/**
 * Why `id` is private from the AI, or null; follows the blocks as they change. With
 * `ancestors`, the pages above it are loaded first (where nothing else has loaded them).
 */
export function useAiPrivacy(id: string | null | undefined, ancestors = false): AiPrivacy | null {
  const selector = useMemo(() => watchSelector((read) => aiPrivacy(read, id), samePrivacy), [id])
  useEffect(() => {
    if (ancestors && id) void loadAncestors(id)
  }, [ancestors, id])
  return useBlockStore(selector)
}

/** Marks a page or database private from the AI, or takes the mark off. Resolves to the new state. */
export async function toggleAiPrivate(id: string): Promise<boolean> {
  const block = getBlock(id)
  if (!block) return false
  const next = block.props.aiPrivate !== true
  await applyOps([{ op: 'update', id, patch: { props: { aiPrivate: next ? true : null } } }])
  return next
}

/** The project option ids of the Tasks database that are private from the AI. */
export function useProjectsPrivate(): readonly string[] {
  const selector = useMemo(() => watchSelector((read) => privateProjects(read.get(TASKS_DATABASE_ID))), [])
  return useBlockStore(selector)
}

/** Marks a project of Tasks private from the AI (every task in it), or takes the mark off. Resolves to the new state. */
export async function toggleProjectPrivate(projectId: string): Promise<boolean> {
  const database = getBlock(TASKS_DATABASE_ID)
  if (!database) return false
  const current = privateProjects(database)
  const next = !current.includes(projectId)
  const list = next ? [...current, projectId] : current.filter((entry) => entry !== projectId)
  await applyOps([{ op: 'update', id: TASKS_DATABASE_ID, patch: { props: { aiPrivateProjects: list.length ? list : null } } }])
  return next
}
