import { cleanBriefingSetting, localDay } from '../../shared/briefing'
import {
  cleanLine,
  cleanPlans,
  entryId,
  isDay,
  isDayWritable,
  lineTitle,
  nextDay,
  NOTEBOOK_ENTRY_TYPE,
  NOTEBOOK_ID,
  NOTEBOOK_TITLES,
  onThisDay,
  readEntry,
  type DayReview,
  type NotebookEntry,
  type NotebookLocale,
  type NotebookView
} from '../../shared/notebook'
import { systemKindOf } from '../../shared/system'
import type { Block, BlockProps } from '../../shared/types'
import type { Repository } from '../db/repository'
import { detectSignal, type TaskBlock } from '../briefing/tasks'
import { hermanLocale } from '../herman/service'
import { collectDay } from './review'

/**
 * The ink notebook and the closing of the day, as the windows use them. Free of Electron
 * imports: the language of the system is handed in by ./register.ts. Every write goes through
 * the repository, which keeps the notebook's rules (a day that has ended stays as it is) for
 * this service as for every other writer.
 */

export interface NotebookDeps {
  repo: Repository
  now?: () => number
  /** The language of the system, as a locale tag. */
  systemLocale?: () => string
}

/** Recently edited pages looked at for what happened today. */
const RECENT_PAGES = 60

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export class NotebookService {
  private readonly repo: Repository
  private readonly now: () => number

  constructor(private readonly deps: NotebookDeps) {
    this.repo = deps.repo
    this.now = deps.now ?? Date.now
  }

  /** The language of the screens: the one set for AI answers when it is one of the two, else the system's. */
  locale(): NotebookLocale {
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

  /** The notebook page when it exists and is one. */
  private root(): Block | null {
    const root = this.repo.get(NOTEBOOK_ID)
    return root && root.type === 'page' && systemKindOf(root) === 'notebook' && root.trashedAt === null ? root : null
  }

  /**
   * Starts the notebook: its page, with the fixed id every device uses, so that two devices
   * that start it on their own make the same block. Does nothing when it is there.
   */
  ensure(): void {
    if (this.root()) return
    if (this.repo.get(NOTEBOOK_ID)) throw new Error('Meditations could not be opened')
    this.repo.create({ id: NOTEBOOK_ID, type: 'page', parentId: null, props: { system: 'notebook', title: [[NOTEBOOK_TITLES[this.locale()]]] } })
  }

  /** Every day the notebook holds, by day. */
  private entries(): Map<string, NotebookEntry> {
    const out = new Map<string, NotebookEntry>()
    if (!this.root()) return out
    for (const block of this.repo.children(NOTEBOOK_ID)) {
      const entry = readEntry(block)
      if (entry) out.set(entry.day, entry)
    }
    return out
  }

  private entry(day: string): NotebookEntry | null {
    const block = this.root() ? this.repo.get(entryId(day)) : null
    return block && block.parentId === NOTEBOOK_ID ? readEntry(block) : null
  }

  get(): NotebookView {
    const today = this.today()
    const all = this.entries()
    const entries = [...all.values()].filter((entry) => entry.text).sort((a, b) => (a.day < b.day ? 1 : -1))
    return { locale: this.locale(), today, todayEntry: all.get(today) ?? null, entries, onThisDay: onThisDay(entries, today) }
  }

  /** Writes props on the block of `day`, creating it when there is none. Null removes a key. */
  private put(day: string, props: Record<string, unknown>): NotebookEntry {
    this.ensure()
    const id = entryId(day)
    const existing = this.repo.get(id)
    const block = existing
      ? this.repo.update(id, { props: props as BlockProps })
      : this.repo.create({ id, type: NOTEBOOK_ENTRY_TYPE, parentId: NOTEBOOK_ID, props: Object.fromEntries(Object.entries(props).filter(([, value]) => value !== null)) as BlockProps })
    const entry = readEntry(block)
    if (!entry) throw new Error('Meditations could not be written')
    return entry
  }

  /** The line of today. Only today: a day that has ended is ink, and one to come has no line yet. */
  write(rawDay: unknown, rawText: unknown): NotebookEntry {
    if (!isDay(rawDay)) throw new Error('Invalid day')
    if (typeof rawText !== 'string' || rawText.length > 20_000) throw new Error('Invalid line')
    const today = this.today()
    if (rawDay < today) throw new Error('That day has ended: what it holds stays as it was written')
    if (rawDay > today) throw new Error('A day can be written once it comes')
    const text = cleanLine(rawText)
    // Nothing written on a day with no block yet: nothing to keep.
    if (!text && !this.entry(rawDay)) return { day: rawDay, text: '', plans: [], plansDismissed: false, updatedAt: 0 }
    return this.put(rawDay, { title: text ? lineTitle(text) : null })
  }

  /** What is set aside for a day to come, up to three things. An empty list takes them back. */
  plan(rawDay: unknown, rawItems: unknown): NotebookEntry {
    if (!isDay(rawDay)) throw new Error('Invalid day')
    if (!Array.isArray(rawItems) || rawItems.length > 20) throw new Error('Invalid plans')
    if (!isDayWritable(rawDay, this.now())) throw new Error('That day has ended: what it holds stays as it was written')
    const items = cleanPlans(rawItems)
    if (!items.length && !this.entry(rawDay)) {
      return { day: rawDay, text: '', plans: [], plansDismissed: false, updatedAt: 0 }
    }
    return this.put(rawDay, { plans: items.length ? items : null, plansDismissed: null })
  }

  /** Puts away the plans of a day that is still open. */
  dismissPlans(rawDay: unknown): void {
    if (!isDay(rawDay)) throw new Error('Invalid day')
    const entry = this.entry(rawDay)
    if (!entry || entry.plansDismissed || !entry.plans.length) return
    if (!isDayWritable(rawDay, this.now())) return
    this.put(rawDay, { plansDismissed: true })
  }

  /** What happened today, read from the workspace as it is stored. */
  review(): DayReview {
    const nowMs = this.now()
    const today = localDay(nowMs)
    const from = startOfLocalDay(nowMs)
    const blocks: TaskBlock[] = []
    const seen = new Set<string>()
    const add = (block: TaskBlock): void => {
      if (seen.has(block.id)) return
      seen.add(block.id)
      blocks.push(block)
    }
    // The task databases the Today screen reads, with their rows.
    const stored = this.repo.getSetting('briefing.databases')
    const chosen = stored === null ? null : (cleanBriefingSetting('briefing.databases', stored) as string[] | undefined) ?? null
    const wanted = chosen ? new Set(chosen) : null
    for (const database of this.repo.listDatabases()) {
      if ((wanted && !wanted.has(database.id)) || !detectSignal(database.props)) continue
      add(database)
      for (const row of this.repo.children(database.id)) if (row.updatedAt >= from) add(row)
    }
    // The pages edited today, with what is on them (their to-dos).
    for (const page of this.repo.listRecent(RECENT_PAGES)) {
      if (page.updatedAt < from) break
      if (page.type !== 'page' || page.id === NOTEBOOK_ID) continue
      if (page.parentId !== null && !seen.has(page.id)) {
        // A row's database decides whether it is a task: it is handed over too.
        const parent = this.repo.get(page.parentId)
        if (parent) add(parent)
      }
      for (const block of this.repo.getTree(page.id)) add(block)
    }
    // Local days are 23 to 25 hours long: the next midnight is found, not added.
    const to = startOfLocalDay(from + 26 * 3_600_000) - 1
    const { completed, edited } = collectDay(blocks, { from, to })
    const todayEntry = this.entry(today)
    const tomorrow = this.entry(nextDay(today))
    return {
      locale: this.locale(),
      today,
      completed,
      edited,
      line: todayEntry?.text ?? '',
      tomorrowPlans: tomorrow && !tomorrow.plansDismissed ? tomorrow.plans : []
    }
  }
}
