import { localDay } from '../../shared/briefing'
import {
  cleanLine,
  entryId,
  isDay,
  lineTitle,
  NOTEBOOK_ENTRY_TYPE,
  NOTEBOOK_ID,
  NOTEBOOK_TITLES,
  onThisDay,
  readEntry,
  type NotebookEntry,
  type NotebookLocale,
  type NotebookView
} from '../../shared/notebook'
import { systemKindOf } from '../../shared/system'
import type { Block, BlockProps } from '../../shared/types'
import type { Repository } from '../db/repository'
import { hermanLocale } from '../herman/service'

/**
 * The ink notebook, as the windows use it. Free of Electron
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
    if (this.repo.get(NOTEBOOK_ID)) throw new Error('The notebook could not be opened')
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
    if (!entry) throw new Error('The notebook could not be written')
    return entry
  }

  /** The line of today. Only today: a day that has ended is ink, and one to come has no line yet. */
  write(rawDay: unknown, rawText: unknown): NotebookEntry {
    if (!isDay(rawDay)) throw new Error('Invalid day')
    if (typeof rawText !== 'string' || rawText.length > 20_000) throw new Error('Invalid line')
    const today = this.today()
    if (rawDay < today) throw new Error('That day has ended: what it holds was written in ink and stays as it is')
    if (rawDay > today) throw new Error('A day can be written once it comes')
    const text = cleanLine(rawText)
    // Nothing written on a day with no block yet: nothing to keep.
    if (!text && !this.entry(rawDay)) return { day: rawDay, text: '', updatedAt: 0 }
    return this.put(rawDay, { title: text ? lineTitle(text) : null })
  }
}
