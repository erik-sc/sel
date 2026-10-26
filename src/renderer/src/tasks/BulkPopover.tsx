// The menu a key opens for a selection of tasks: D asks for a day (a short menu, since a day for
// many tasks is a choice, not a month to browse), # for a project. The choice goes to every task
// of the selection through tasks/bulk.ts. Closing it gives the focus back to the row it came from.
import type { JSX } from 'react'
import type { QuickDate } from '@shared/tasks/dates'
import { TASK_PROPS, TASKS_DATABASE_ID } from '@shared/tasks'
import { useBlock } from '@/store/blocks'
import { useHome } from '@/home/store'
import * as L from '@/database/logic'
import { Floating } from '@/database/common'
import { DATE_COPY } from '@/database/dateCopy'
import { SelectEditor } from '@/database/SelectEditor'
import { Menu, type MenuItem } from '@/ui/Menu'
import { setDateMany, setPriorityMany, setProjectMany } from './bulk'
import { TASK_COPY } from './copy'

const QUICK: readonly QuickDate[] = ['today', 'tomorrow', 'weekend', 'nextWeek']

export interface BulkPopoverProps {
  field: 'date' | 'project' | 'priority'
  /** The selected tasks. */
  ids: readonly string[]
  /** The row the key was pressed on: the menu opens at it, and the focus returns to it. */
  anchor: HTMLElement
  onClose: () => void
}

export function BulkPopover({ field, ids, anchor, onClose }: BulkPopoverProps): JSX.Element | null {
  const locale = useHome((state) => state.locale)
  const words = TASK_COPY[locale]
  const dates = DATE_COPY[locale]
  const database = useBlock(TASKS_DATABASE_ID)
  const close = (): void => {
    onClose()
    if (anchor.isConnected) anchor.focus({ preventScroll: true })
  }

  if (field === 'date') {
    const items: MenuItem[] = [
      { header: words.manyHeader(ids.length) },
      ...QUICK.map((choice): MenuItem => ({ id: choice, label: dates.quick[choice], onSelect: () => setDateMany(ids, choice) })),
      { id: 'none', label: dates.quick.none, onSelect: () => setDateMany(ids, null) }
    ]
    return (
      <Floating open anchor={anchor} onClose={close} role="none">
        <Menu autoFocus items={items} onClose={close} />
      </Floating>
    )
  }

  if (field === 'priority') {
    const items: MenuItem[] = [
      { header: words.priorityHeader(ids.length) },
      ...([1, 2, 3, 4] as const).map(
        (level): MenuItem => ({
          id: `p${level}`,
          label: words.priorityName(level),
          onSelect: () => setPriorityMany(ids, level)
        })
      )
    ]
    return (
      <Floating open anchor={anchor} onClose={close} role="none">
        <Menu autoFocus items={items} onClose={close} />
      </Floating>
    )
  }

  const prop = database ? L.propOf(L.normalizeDatabase(database).schema, TASK_PROPS.project) : undefined
  if (!prop) return null
  return (
    <Floating open anchor={anchor} onClose={close} label={words.field.project} className="db-popover">
      <div className="task-editor">
        <SelectEditor
          databaseId={TASKS_DATABASE_ID}
          prop={prop}
          multiple={false}
          value={[]}
          onChange={(update) => setProjectMany(ids, update([]).at(-1) ?? null)}
          onClose={close}
        />
      </div>
    </Floating>
  )
}
