// The strip at the foot of a Tasks list while two or more rows are selected: how many, the same
// changes the keys make as buttons for the mouse, and Let go (the only way to remove many at
// once; the Delete key stays for one task). Let go asks once, naming the count, and moves the
// tasks to the Trash with one Undo (edit.ts). Absent for one row or none: nothing is shown that
// the user did not pick.
import { useId, useState } from 'react'
import { Close } from '@/ui/icons'
import type { JSX } from 'react'
import { useHome } from '@/home/store'
import { Button, IconButton } from '@/ui/Button'
import { Floating } from '@/database/common'
import { Menu, type MenuItem } from '@/ui/Menu'
import { Modal } from '@/ui/Modal'
import { TASK_COPY } from './copy'
import { letGoTasks } from './edit'
import { MANY } from './selection'

export type BarMenu = 'date' | 'priority' | 'project'

export interface SelectionBarProps {
  /** The selected tasks. */
  ids: readonly string[]
  /** A button that asks for a choice: the menu opens at `anchor`, the button pressed. */
  onMenu: (field: BarMenu, anchor: HTMLElement) => void
  /** Done for all, or back to open when every one is done already (as Space does). */
  onToggle: () => void
  onClear: () => void
  /** After the tasks were let go: the list gets the focus back. */
  onLetGo: () => void
}

export function SelectionBar({ ids, onMenu, onToggle, onClear, onLetGo }: SelectionBarProps): JSX.Element | null {
  const words = TASK_COPY[useHome((state) => state.locale)]
  const [asking, setAsking] = useState(false)
  // "Change" opens a short menu of the fields; the choice opens that field's own menu at the same button.
  const [changing, setChanging] = useState<HTMLElement | null>(null)
  const titleId = useId()
  if (ids.length < MANY) return null
  return (
    <>
      <div className="task-bar">
        <div className="task-bar-inner" role="group" aria-label={words.barLabel}>
          <span className="task-bar-count">{words.selected(ids.length)}</span>
          <div className="task-bar-actions">
            <Button variant="ghost" aria-haspopup="menu" aria-expanded={!!changing} onClick={(event) => setChanging(event.currentTarget)}>
              {words.changeMany}
            </Button>
            <Button variant="ghost" onClick={onToggle}>
              {words.markDone}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(true)}>
              {words.letGo}
            </Button>
            <IconButton label={words.deselect} size="small" onClick={onClear}>
              <Close />
            </IconButton>
          </div>
        </div>
      </div>
      {changing && (
        <Floating open anchor={changing} onClose={() => setChanging(null)} role="none">
          <Menu
            autoFocus
            onClose={() => {
              const anchor = changing
              setChanging(null)
              if (anchor.isConnected) anchor.focus({ preventScroll: true })
            }}
            items={(['date', 'priority', 'project'] as const).map(
              (field): MenuItem => ({
                id: field,
                label: words.field[field],
                onSelect: () => {
                  const anchor = changing
                  setChanging(null)
                  onMenu(field, anchor)
                }
              })
            )}
          />
        </Floating>
      )}
      <Modal open={asking} onClose={() => setAsking(false)} labelledBy={titleId} className="task-ask">
        <h2 id={titleId} className="task-ask-title">
          {words.letGoTitle(ids.length)}
        </h2>
        <p className="task-ask-body">{words.letGoBody}</p>
        <div className="task-ask-actions">
          <Button autoFocus onClick={() => setAsking(false)}>
            {words.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setAsking(false)
              letGoTasks(ids)
              onLetGo()
            }}
          >
            {words.letGo}
          </Button>
        </div>
      </Modal>
    </>
  )
}
