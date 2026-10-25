// The strip at the foot of a Tasks list while two or more rows are selected: how many, the same
// changes the keys make as buttons for the mouse, and Let go (the only way to remove many at
// once; the Delete key stays for one task). Let go asks once, naming the count, and moves the
// tasks to the Trash with one Undo (edit.ts). Absent for one row or none: nothing is shown that
// the user did not pick.
import { useId, useState } from 'react'
import type { JSX } from 'react'
import { useHome } from '@/home/store'
import { Button } from '@/ui/Button'
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
  const titleId = useId()
  if (ids.length < MANY) return null
  return (
    <>
      <div className="task-bar" role="toolbar" aria-label={words.barLabel}>
        <span className="task-bar-count">{words.selected(ids.length)}</span>
        <div className="task-bar-actions">
          <Button variant="ghost" onClick={(event) => onMenu('date', event.currentTarget)}>
            {words.field.date}
          </Button>
          <Button variant="ghost" onClick={(event) => onMenu('priority', event.currentTarget)}>
            {words.field.priority}
          </Button>
          <Button variant="ghost" onClick={(event) => onMenu('project', event.currentTarget)}>
            {words.field.project}
          </Button>
          <Button variant="ghost" onClick={onToggle}>
            {words.markDone}
          </Button>
          <Button variant="ghost" onClick={() => setAsking(true)}>
            {words.letGo}
          </Button>
          <Button variant="ghost" onClick={onClear}>
            {words.deselect}
          </Button>
        </div>
      </div>
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
