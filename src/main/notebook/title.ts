import { NOTEBOOK_ID, renamedNotebookTitle } from '../../shared/notebook'
import { systemKindOf } from '../../shared/system'
import type { Repository } from '../db/repository'

/**
 * Gives the notebook page its new name (Meditations / Meditações) when it still has the default
 * one it was made with before 0.6.0 ("Ink notebook" / "Caderno de tinta"). Run at every start:
 * one read when there is nothing to do, and a title the user chose is never touched. Every
 * device writes the same value, so a sync between them merges without a conflict.
 * Returns true when the page was renamed.
 */
export function migrateNotebookTitle(repo: Repository): boolean {
  const page = repo.get(NOTEBOOK_ID)
  if (!page || page.type !== 'page' || systemKindOf(page) !== 'notebook') return false
  const title = renamedNotebookTitle(page.props.title)
  if (!title) return false
  repo.update(NOTEBOOK_ID, { props: { title } })
  return true
}
