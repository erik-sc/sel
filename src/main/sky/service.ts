import { localDay } from '../../shared/briefing'
import { NOTEBOOK_ID, readEntry } from '../../shared/notebook'
import { POMODORO_HISTORY_KEY, type PomodoroCompleted } from '../../shared/pomodoro'
import {
  cleanSkyName,
  eventOf,
  figureOfMonth,
  firstStarDay,
  isMonth,
  monthName,
  nameId,
  pomodoroEventId,
  readLocalState,
  SKY_BACKFILLED_KEY,
  SKY_ENABLED_KEY,
  SKY_EVENTS_KEY,
  SKY_HEMISPHERE_KEY,
  SKY_ID,
  SKY_NAME_PREFIX,
  SKY_POMODORO_PREFIX,
  SKY_TITLES,
  SKY_TODO_PREFIX,
  SHOWER_NAMES,
  skyEnabled,
  skyHemisphere,
  todoEventId,
  type SkyEvent,
  type SkyMark,
  type SkyMoment,
  type SkyView
} from '../../shared/sky'
import { systemKindOf } from '../../shared/system'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import type { Block, BlockProps } from '../../shared/types'
import type { Repository } from '../db/repository'
import type { SkyLineMoment } from '../herman/lines'
import { hermanLocale } from '../herman/service'

/**
 * The Sky, as the windows read it (shared/sky). Almost everything is derived: the stars from the
 * days of Meditations, the dust of the Tasks database from `completedAt`. What has nowhere else
 * to live is written under the built-in page `sel-sky`, one block per happening with an id fixed
 * by what happened, written once and never edited: two devices that write the same thing make the
 * same block, and syncing them is a union. Free of Electron imports: ./register.ts wires it.
 */

export interface SkyDeps {
  repo: Repository
  now?: () => number
  /** The language of the system, as a locale tag. */
  systemLocale?: () => string
}

/** A written happening, as it is stored under `sel-sky`. */
interface SkyEventProps {
  sky: 'grain' | 'pomodoro'
  day: string
  at: number
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DDTHH:mm' on the wall clock of this computer, as ms. */
function wallClock(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 12), Number(m[5] ?? 0)).getTime()
}

export class SkyService {
  private readonly repo: Repository
  private readonly now: () => number

  constructor(private readonly deps: SkyDeps) {
    this.repo = deps.repo
    this.now = deps.now ?? Date.now
  }

  locale(): 'en' | 'pt-BR' {
    let language: unknown = null
    try {
      language = this.repo.getSetting('ai.language')
    } catch {
      /* the system's, then */
    }
    return hermanLocale(language, this.deps.systemLocale?.())
  }

  private today(): string {
    return localDay(this.now())
  }

  /** The Sky's page when it exists and is one. */
  private root(): Block | null {
    const root = this.repo.get(SKY_ID)
    return root && root.type === 'page' && systemKindOf(root) === 'sky' && root.trashedAt === null ? root : null
  }

  /** Starts the Sky's page, with the fixed id every device uses. Does nothing when it is there. */
  ensure(): void {
    if (this.root()) return
    if (this.repo.get(SKY_ID)) throw new Error('The Sky could not be opened')
    this.repo.create({ id: SKY_ID, type: 'page', parentId: null, props: { system: 'sky', title: [[SKY_TITLES[this.locale()]]] } })
  }

  /** Writes a happening once: a block that is already there is left as it is. */
  private record(id: string, props: SkyEventProps): boolean {
    if (this.repo.get(id)) return false
    this.ensure()
    this.repo.create({ id, type: 'text', parentId: SKY_ID, props: props as unknown as BlockProps })
    return true
  }

  /**
   * A to-do on a page was checked: a grain of dust for today. Checking it again the same day
   * writes nothing new; the Tasks database keeps its own `completedAt` and is not counted here.
   */
  recordTodo(blockId: string): boolean {
    const block = this.repo.get(blockId)
    if (!block || block.type !== 'to_do' || block.props.checked !== true) return false
    if (block.parentId === SKY_ID || block.parentId === NOTEBOOK_ID) return false
    const at = this.now()
    return this.record(todoEventId(blockId, localDay(at)), { sky: 'grain', day: localDay(at), at })
  }

  /** A focus phase of the pomodoro ran to its end: a halo on that day's star. */
  recordPomodoro(event: PomodoroCompleted): boolean {
    if (!event || typeof event.at !== 'number' || !Number.isFinite(event.at) || event.at <= 0) return false
    return this.record(pomodoroEventId(event.at), { sky: 'pomodoro', day: localDay(event.at), at: Math.round(event.at) })
  }

  /**
   * This computer's own pomodoro history (`pomodoro.completed`, never synced) written into the sky,
   * once. The ids are the same as the live ones, so doing it again would add nothing.
   */
  backfillPomodoros(): number {
    if (this.repo.getSetting(SKY_BACKFILLED_KEY) === true) return 0
    const stored = this.repo.getSetting(POMODORO_HISTORY_KEY)
    let written = 0
    if (Array.isArray(stored)) {
      for (const entry of stored as unknown[]) {
        if (entry && typeof entry === 'object' && this.recordPomodoro(entry as PomodoroCompleted)) written++
      }
    }
    this.repo.setSetting(SKY_BACKFILLED_KEY, true)
    return written
  }

  /** Names the constellation of `month`. An empty name gives back the figure's; the last write wins. */
  name(rawMonth: unknown, rawText: unknown): void {
    if (!isMonth(rawMonth)) throw new Error('Invalid month')
    if (typeof rawText !== 'string' || rawText.length > 2000) throw new Error('Invalid name')
    const text = cleanSkyName(rawText)
    const id = nameId(rawMonth)
    const existing = this.repo.get(id)
    if (existing) {
      if (existing.parentId !== SKY_ID) throw new Error('Invalid name')
      if ((existing.props as Record<string, unknown>).text !== text) this.repo.update(id, { props: { text } as BlockProps })
      return
    }
    if (!text) return
    this.ensure()
    this.repo.create({ id, type: 'text', parentId: SKY_ID, props: { sky: 'name', text } as unknown as BlockProps })
  }

  /** Everything the sky is drawn from. Reading never creates anything (the pomodoro backfill aside). */
  view(): SkyView {
    try {
      this.backfillPomodoros()
    } catch (err) {
      console.error('[sky] the local pomodoros could not be written', err)
    }
    const locale = this.locale()
    const meditations: { day: string; text: string }[] = []
    const notebook = this.repo.get(NOTEBOOK_ID)
    if (notebook && systemKindOf(notebook) === 'notebook') {
      for (const block of this.repo.children(NOTEBOOK_ID)) {
        const entry = readEntry(block)
        if (entry && entry.text) meditations.push({ day: entry.day, text: entry.text })
      }
    }

    const grains: SkyMark[] = []
    const tasks = this.repo.get(TASKS_DATABASE_ID)
    if (tasks && systemKindOf(tasks) === 'tasks') {
      for (const row of this.repo.children(TASKS_DATABASE_ID)) {
        const values = row.props.values as Record<string, unknown> | undefined
        const done = values?.[TASK_PROPS.completedAt] as { start?: unknown } | undefined
        const start = typeof done?.start === 'string' ? done.start : null
        if (!start || !DAY_RE.test(start.slice(0, 10))) continue
        grains.push({ key: `task:${row.id}:${start}`, day: start.slice(0, 10), at: wallClock(start) })
      }
    }

    const pomodoros: SkyMark[] = []
    const names: Record<string, string> = {}
    if (this.root()) {
      for (const block of this.repo.children(SKY_ID)) {
        const props = block.props as Record<string, unknown>
        if (block.id.startsWith(SKY_NAME_PREFIX)) {
          const month = block.id.slice(SKY_NAME_PREFIX.length)
          const text = cleanSkyName(props.text)
          if (isMonth(month) && text) names[month] = text
          continue
        }
        const day = typeof props.day === 'string' && DAY_RE.test(props.day) ? props.day : null
        if (!day) continue
        const at = typeof props.at === 'number' && Number.isFinite(props.at) ? props.at : 0
        if (block.id.startsWith(SKY_TODO_PREFIX) && props.sky === 'grain') grains.push({ key: block.id, day, at })
        else if (block.id.startsWith(SKY_POMODORO_PREFIX) && props.sky === 'pomodoro') pomodoros.push({ key: block.id, day, at })
      }
    }

    const get = (key: string): unknown => this.repo.getSetting(key)
    return {
      meditations,
      grains,
      pomodoros,
      names,
      hemisphere: skyHemisphere(get(SKY_HEMISPHERE_KEY), locale),
      locale,
      today: this.today(),
      enabled: skyEnabled(get(SKY_ENABLED_KEY)),
      events: get(SKY_EVENTS_KEY) !== false,
      local: readLocalState(get)
    }
  }

  /**
   * What a moment the Sky played was about, worked out from what is stored (a window only says
   * that it came): the month's name (the user's, or none for the figure's), or tonight's event.
   * Null when there is nothing to say.
   */
  moment(moment: SkyMoment): SkyMomentFacts | null {
    const view = this.view()
    if (!view.enabled) return null
    if (moment.kind === 'named') {
      if (moment.month >= view.today.slice(0, 7)) return null
      if (!view.meditations.some((m) => m.day.startsWith(moment.month))) return null
      return { kind: 'named', month: moment.month, given: view.names[moment.month] ?? null }
    }
    if (!view.events) return null
    const event = eventOf(view.today, { hemisphere: view.hemisphere, firstStarDay: firstStarDay(view) })
    return event ? { kind: 'night', event, year: Number(view.today.slice(0, 4)) } : null
  }
}

export type SkyMomentFacts = { kind: 'named'; month: string; given: string | null } | { kind: 'night'; event: SkyEvent; year: number }

/** Herman's line for a moment, in his language, or null when the moment is not one he speaks of. */
export function skyLineMoment(facts: SkyMomentFacts, locale: 'en' | 'pt-BR'): SkyLineMoment | null {
  if (facts.kind === 'named') {
    const fig = figureOfMonth(facts.month)
    return { kind: 'named', month: monthName(facts.month, locale), name: facts.given ?? (locale === 'pt-BR' ? fig.pt : fig.en), given: facts.given !== null }
  }
  const e = facts.event
  switch (e.kind) {
    case 'meteors':
      return { kind: 'meteors', shower: SHOWER_NAMES[locale][e.shower] }
    case 'eclipse':
      return { kind: 'eclipse' }
    case 'comet':
      return e.night === 0 ? { kind: 'comet' } : null
    case 'anniversary':
      return { kind: 'anniversary' }
    case 'season':
      return e.mark === 'winter-solstice' ? { kind: 'longest-night' } : null
    case 'new-year':
      return { kind: 'new-year', year: facts.year }
    default:
      return null
  }
}
