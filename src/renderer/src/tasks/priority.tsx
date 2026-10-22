// The priority choices as menu items, for the row's menu and the priority editor.
import type { MenuItem } from '@/ui/Menu'
import { tagStyle } from '@/database/common'
import type { TaskCopy } from './copy'
import type { Priority } from './model'

export const LEVELS: readonly Priority[] = [1, 2, 3, 4]
const LEVEL_COLOR: Record<Priority, string> = { 1: 'red', 2: 'orange', 3: 'blue', 4: 'gray' }

/** P1 to P4, then none; the current one is marked. */
export function priorityItems(current: Priority | null, words: TaskCopy, pick: (level: Priority | null) => void): MenuItem[] {
  return [
    ...LEVELS.map(
      (level): MenuItem => ({
        id: `p${level}`,
        label: words.priorityName(level),
        hint: current === level ? '✓' : String(level),
        icon: <span className="task-flag" style={tagStyle(LEVEL_COLOR[level])} aria-hidden="true" />,
        onSelect: () => pick(level)
      })
    ),
    { id: 'none', label: words.noPriority, hint: current === null ? '✓' : undefined, onSelect: () => pick(null) }
  ]
}
