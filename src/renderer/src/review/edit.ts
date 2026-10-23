// Writing the week's focus (shared/tasks/week.ts) on the Tasks database block, as `props.week`,
// the way tasks/projects.ts writes `props.projects`: built from the block as the store has it
// when the change lands.
import { TASKS_DATABASE_ID } from '@shared/tasks'
import { withWeekFocus } from '@shared/tasks/week'
import { getBlock } from '@/store/blocks'
import * as L from '@/database/logic'
import * as actions from '@/database/actions'

/** Stores the focus and note of the week starting `start` (a Monday); nothing chosen and no note takes it out. */
export function saveWeekFocus(start: string, focus: readonly string[], note: string, today: string = L.todayISO()): void {
  const database = getBlock(TASKS_DATABASE_ID)
  if (!database) return
  const next = withWeekFocus(database.props.week, start, focus, note, today)
  if (JSON.stringify(next) === JSON.stringify(database.props.week ?? null)) return
  actions.runOps([{ op: 'update', id: TASKS_DATABASE_ID, patch: { props: { week: next } } }])
}
