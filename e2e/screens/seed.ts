/**
 * The demo workspace every capture opens: a fresh `sel.db` written through the app's own
 * `Repository` on Node's built-in SQLite, so its schema and migrations are the app's.
 *
 * The `Repository` (and `ensureTasksDatabase`) come from the side being captured: base is seeded
 * with base's code, so a migration added by the pull request never leaves base with a database
 * newer than it understands. What goes in is always this file's, from the pull request's head.
 * (`openTestRepository` is not used: it reads `import.meta`, which Playwright's CommonJS
 * transform rejects.)
 *
 * Text is fixed English; dates are relative to `now`, one moment per job, so both sides agree.
 * Free of Electron and of the renderer.
 */

import { DatabaseSync } from 'node:sqlite'
import type { Repository } from '../../src/main/db/repository'
import { AI_ONBOARDED_KEY } from '../../src/shared/ai'
import { TASK_PROPS } from '../../src/shared/tasks'
import type { BlockProps, BlockType, DatabaseView, Op, PropertySchema, RichText } from '../../src/shared/types'
import type { Theme } from './registry'

/** What the seed needs from a checkout's code. */
export interface SeedCode {
  Repository: new (db: DatabaseSync, options: { clock: () => number }) => Repository
  ensureTasksDatabase: (repo: Repository) => string
}

export interface SeedOptions {
  theme: Theme
  locale: 'en' | 'pt-BR'
  now: Date
  /** A scenario's additions, run after the demo content. */
  workspace?: (repo: Repository, now: Date) => void
}

/** Fixed ids, so two seeds (and base and head) write the same blocks. */
export const SEED_IDS = {
  notes: 'screens-notes',
  projects: 'screens-projects',
  projectWebsite: 'screens-project-website',
  projectGarden: 'screens-project-garden',
  boardByPriority: 'screens.view.priority',
  calendar: 'screens.view.calendar'
} as const

/** Names the scenarios click on. */
export const SEED_NAMES = {
  notes: 'Notes',
  projects: 'Projects',
  table: 'All tasks',
  boardByPriority: 'By priority',
  calendar: 'Calendar'
} as const

const P = TASK_PROPS
const VISIBLE = [P.title, P.done, P.due, P.priority, P.project, P.labels]

const PROJECTS = [
  { id: 'screens.project.website', name: 'Website', color: 'blue' },
  { id: 'screens.project.garden', name: 'Garden', color: 'green' },
  { id: 'screens.project.admin', name: 'Admin', color: 'purple' }
]
const LABELS = [
  { id: 'screens.label.errand', name: 'errand', color: 'orange' },
  { id: 'screens.label.call', name: 'call', color: 'pink' },
  { id: 'screens.label.reading', name: 'reading', color: 'brown' }
]

interface TaskRow {
  title: string
  /** Days from today; null: no due date. */
  due: number | null
  priority: 1 | 2 | 3 | 4
  project?: 'website' | 'garden' | 'admin'
  labels?: ('errand' | 'call' | 'reading')[]
  done?: boolean
}

/** Two overdue, two today, two this week, two next week, two without a date, two done. */
export const TASK_ROWS: readonly TaskRow[] = [
  { title: 'Renew the domain', due: -3, priority: 1, project: 'website', labels: ['errand'] },
  { title: 'Call the plumber back', due: -1, priority: 2, project: 'admin', labels: ['call'] },
  { title: 'Write the launch post', due: 0, priority: 1, project: 'website' },
  { title: 'Water the tomatoes', due: 0, priority: 3, project: 'garden', labels: ['errand'] },
  { title: 'Review the quarterly budget', due: 2, priority: 2, project: 'admin', labels: ['reading'] },
  { title: 'Order mulch', due: 4, priority: 4, project: 'garden', labels: ['errand'] },
  { title: 'Fix the contact form', due: 8, priority: 2, project: 'website' },
  { title: 'Plan the autumn beds', due: 10, priority: 3, project: 'garden', labels: ['reading'] },
  { title: 'Sort the receipts', due: null, priority: 4, project: 'admin' },
  { title: 'Read about composting', due: null, priority: 4, labels: ['reading'] },
  { title: 'Book the dentist', due: 0, priority: 3, project: 'admin', labels: ['call'], done: true },
  { title: 'Update the footer links', due: -1, priority: 3, project: 'website', done: true }
]

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** A local day, `YYYY-MM-DD`, `offset` days from `now`. */
export function localDay(now: Date, offset = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Writes the demo workspace to `file` (which must not exist yet) and closes it. */
export function seedWorkspace(code: SeedCode, file: string, options: SeedOptions): void {
  const { now } = options
  const at = Math.floor(now.getTime() / 60_000) * 60_000
  const repo = new code.Repository(new DatabaseSync(file), { clock: () => at })
  try {
    repo.setSetting('seeded', true)
    repo.setSetting(AI_ONBOARDED_KEY, true)
    repo.setSetting('ai.language', options.locale)
    repo.setSetting('theme', options.theme)

    pages(repo)
    tasks(repo, code, now)
    options.workspace?.(repo, now)
    repo.drainChanges()
  } finally {
    repo.close()
  }
}

function pages(repo: Repository): void {
  const ops: Op[] = []
  const add = (id: string, type: BlockType, parentId: string | null, props: BlockProps = {}): string => {
    ops.push({ op: 'create', input: { id, type, parentId, props } })
    return id
  }
  const t = (text: string): RichText => [[text]]
  let n = 0
  const next = (): string => `screens-block-${pad(++n, 3)}`

  const notes = add(SEED_IDS.notes, 'page', null, { title: t(SEED_NAMES.notes), icon: '📝' })
  add(next(), 'heading_1', notes, { title: t('Weekly notes') })
  add(next(), 'text', notes, {
    title: [
      ['A quiet week. The '],
      ['website', [['b']]],
      [' launch moved to Thursday, and the garden needs '],
      ['a lot', [['i']]],
      [' of water.']
    ]
  })
  add(next(), 'heading_2', notes, { title: t('This week') })
  add(next(), 'to_do', notes, { title: t('Send the draft to Ana'), checked: true })
  add(next(), 'to_do', notes, { title: t('Choose the photos for the post'), checked: false })
  add(next(), 'to_do', notes, { title: t('Check the backups'), checked: false })
  add(next(), 'callout', notes, {
    icon: '💡',
    title: t('Keep Friday afternoon free for the garden.'),
    color: 'yellow_background'
  })
  const toggle = add(next(), 'toggle', notes, { title: t('Ideas for later'), collapsed: false })
  add(next(), 'text', toggle, { title: t('A small newsletter, once a month, with what grew and what did not.') })

  const projects = add(SEED_IDS.projects, 'page', null, { title: t(SEED_NAMES.projects), icon: '🗂️' })
  add(SEED_IDS.projectWebsite, 'page', projects, { title: t('Website'), icon: '🌐' })
  add(next(), 'text', SEED_IDS.projectWebsite, { title: t('The new site goes live with the launch post.') })
  add(SEED_IDS.projectGarden, 'page', projects, { title: t('Garden'), icon: '🌱' })
  add(next(), 'text', SEED_IDS.projectGarden, { title: t('Tomatoes, beans and the autumn beds.') })

  repo.apply(ops)
}

function tasks(repo: Repository, code: SeedCode, now: Date): void {
  const id = code.ensureTasksDatabase(repo)
  const database = repo.get(id)
  if (!database) throw new Error('The Tasks database was not created')
  const schema = { ...(database.props.schema ?? {}) } as Record<string, PropertySchema>
  const withOptions = (key: string, options: typeof PROJECTS): void => {
    const property = schema[key]
    if (property) schema[key] = { ...property, options: options.map((o) => ({ ...o })) }
  }
  withOptions(P.project, PROJECTS)
  withOptions(P.labels, LABELS)
  const views: DatabaseView[] = [
    ...(database.props.views ?? []),
    {
      id: SEED_IDS.boardByPriority,
      name: SEED_NAMES.boardByPriority,
      type: 'board',
      visibleProperties: [...VISIBLE],
      filters: [],
      sorts: [],
      groupBy: P.priority
    },
    {
      id: SEED_IDS.calendar,
      name: SEED_NAMES.calendar,
      type: 'calendar',
      visibleProperties: [...VISIBLE],
      filters: [],
      sorts: [],
      groupBy: P.due
    }
  ]
  repo.update(id, { props: { schema, views } })

  const doneAt = `${localDay(now)}T${pad(Math.min(now.getHours(), 9))}:00`
  const ops: Op[] = TASK_ROWS.map((row, n) => {
    const values: Record<string, unknown> = { [P.priority]: `tasks.p${row.priority}`, [P.done]: row.done === true }
    if (row.due !== null) values[P.due] = { start: localDay(now, row.due) }
    if (row.project) values[P.project] = `screens.project.${row.project}`
    if (row.labels) values[P.labels] = row.labels.map((label) => `screens.label.${label}`)
    if (row.done) values[P.completedAt] = { start: doneAt }
    return {
      op: 'create',
      input: { id: `screens-task-${pad(n + 1)}`, type: 'page', parentId: id, props: { title: [[row.title]], values } as BlockProps }
    }
  })
  repo.apply(ops)
}
