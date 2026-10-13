import type { Block } from '@shared/types'
import { sourceIdOf } from '@shared/linked'
import { plainText } from '@shared/richtext'
import { useBlock } from '@/store/blocks'

export { isLinkedView, sourceIdOf } from '@shared/linked'

/**
 * The source database of a linked view (loaded on demand and kept while the caller is
 * mounted); undefined for anything else, and while the source is not loaded or gone.
 */
export function useSource(block: Block | undefined | null): Block | undefined {
  const source = useBlock(sourceIdOf(block))
  return source?.type === 'database' ? source : undefined
}

/**
 * The name a page goes by in the shell (sidebar, tabs, breadcrumb). A linked view
 * without a title of its own goes by its source's.
 */
export function usePageTitle(block: Block | undefined | null): string {
  const source = useSource(block)
  return plainText(block?.props.title) || plainText(source?.props.title) || 'Untitled'
}
