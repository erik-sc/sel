import type { Block } from '@shared/types'
import { ArrowUpRight, Database, DatabaseLinked, Page } from '@/ui/icons'
import { IconGlyph } from '@/ui/IconGlyph'
import { sourceIdOf, useSource } from './linked'

/**
 * A page's icon, or a generic page/database glyph when it has none. A linked view
 * shows its source's icon unless it has its own, and is always marked as a link
 * (its own glyph, or a small arrow on the icon) so that it reads as a view of a
 * database rather than as the database.
 */
export function PageIcon({ block, size = 16 }: { block: Block | undefined | null; size?: number }) {
  const linked = sourceIdOf(block) !== null
  const source = useSource(block)
  const icon = block?.props.icon || (linked ? source?.props.icon : undefined)
  if (icon) {
    return (
      <span
        className={linked ? 'page-icon is-emoji is-linked' : 'page-icon is-emoji'}
        style={{ fontSize: size, width: size + 2, height: size + 2 }}
      >
        <IconGlyph icon={icon} />
        {linked && <ArrowUpRight className="page-icon-link" size={Math.round(size / 2)} />}
      </span>
    )
  }
  return (
    <span className={linked ? 'page-icon is-linked' : 'page-icon'} style={{ width: size + 2, height: size + 2 }}>
      {linked ? <DatabaseLinked size={size} /> : block?.type === 'database' ? <Database size={size} /> : <Page size={size} />}
    </span>
  )
}
