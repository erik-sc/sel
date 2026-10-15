import { randomUUID } from 'node:crypto'
import {
  BRIEFING_LIMITS,
  cleanBriefingSetting,
  isCalendarColor,
  localDay,
  TRADITION_LABELS,
  TRADITIONS,
  type Briefing,
  type BriefingAgenda,
  type BriefingCalendar,
  type BriefingDatabase,
  type BriefingEvent,
  type BriefingPhrase,
  type BriefingTask,
  type CalendarTestResult,
  type OwnPhrases,
  type Tradition
} from '../../shared/briefing'
import { CALENDAR_ERROR_TEXT } from '../../shared/briefing'
import { plainText } from '../../shared/richtext'
import { systemKindOf } from '../../shared/system'
import { completeTaskValues } from '../../shared/tasks/recur'
import type { Block, BlockProps, DatabaseView, PropertySchema, PropertyValue } from '../../shared/types'
import type { BriefingPromptData } from '../ai/prompts'
import type { Repository } from '../db/repository'
import * as arg from '../validate'
import { localMidnight, type CalendarService } from './calendars'
import { CalendarError } from './net'
import { fromQuote, ownPhrases, phraseColumns, pickPhrase, readHistory, recordPhrase, type PhraseCandidate } from './phrases'
import { QUOTES, quoteById } from './quotes'
import type { CalendarStore } from './secrets'
import { detectSignal, planCompletion, planUndo, selectTasks, type TaskBlock } from './tasks'

/**
 * The briefing as the app uses it: the workspace, the calendars and the phrases put together.
 * Free of Electron imports; the profile directory, the key store and the windows are handed in
 * by ./index.ts.
 */

/** Settings only the main process writes. */
const PHRASE_DAY_KEY = 'briefing.phraseDay'
const PHRASE_HISTORY_KEY = 'briefing.phraseHistory'

const DAY_MS = 86_400_000
const UNDO_TTL_MS = 10 * 60_000
const MAX_UNDO = 50
const TODO_DAYS = 7
/** Recently edited pages whose to-dos are looked at. */
const TODO_PAGES = 40
const GROUP_CAP = 200
/** Dated tasks one span of the calendar screen may hold. */
const AGENDA_CAP = 500
const PHRASES_TITLE = 'Phrases'

interface Undo {
  id: string
  at: number
  /** A row: the values it had. A to-do: nothing (it was unchecked). */
  previous?: Record<string, PropertyValue | undefined>
}

export interface BriefingDeps {
  repo: Repository
  store: CalendarStore
  calendars: CalendarService
  now?: () => number
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "Good morning" before noon, "Good afternoon" until six, "Good evening" after (and before five). */
export function greetingFor(now: Date, name?: string | null): string {
  const hour = now.getHours()
  const base = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening'
  const first = typeof name === 'string' ? name.trim().split(/\s+/)[0] : ''
  return first ? `${base}, ${first}` : base
}

export class BriefingService {
  private readonly repo: Repository
  private readonly now: () => number
  private readonly undo = new Map<string, Undo>()

  constructor(private readonly deps: BriefingDeps) {
    this.repo = deps.repo
    this.now = deps.now ?? Date.now
  }

  // ---- settings -------------------------------------------------------------

  private setting<T>(key: string, fallback: T): T {
    try {
      const stored = this.repo.getSetting(key)
      if (stored === null || stored === undefined) return fallback
      const clean = cleanBriefingSetting(key, stored)
      return clean === undefined ? fallback : (clean as T)
    } catch {
      return fallback
    }
  }

  // ---- the briefing ---------------------------------------------------------

  /**
   * The briefing from what is stored. With `force`, or the first time a calendar is due, the
   * calendars are read first; otherwise a due calendar is read in the background and the
   * windows hear about it through `briefing:changed`.
   */
  async get(force = false): Promise<Briefing> {
    const { calendars } = this.deps
    if (force) await calendars.refresh(true)
    else if (calendars.stale()) void calendars.refresh(false)
    return this.build()
  }

  build(): Briefing {
    const nowMs = this.now()
    const now = new Date(nowMs)
    const date = localDay(now)
    const today = startOfLocalDay(nowMs)
    // Local days are 23 to 25 hours long: the next midnight is found, not added.
    const tomorrow = startOfLocalDay(today + 26 * 3_600_000)
    const dayAfter = startOfLocalDay(tomorrow + 26 * 3_600_000)

    const databases = this.repo.listDatabases()
    const phrasesDb = this.phrasesDatabase(databases)
    const events = this.deps.calendars.events(today, tomorrow)
    const next = this.deps.calendars.events(tomorrow, dayAfter).find((event) => event.start >= tomorrow)
    const briefing: Briefing = {
      date,
      greeting: greetingFor(now, this.setting<string>('briefing.name', '')),
      phrase: this.phraseOfDay(date, phrasesDb),
      hasPhrases: phrasesDb !== null,
      events: { today: events, calendars: this.deps.calendars.status() },
      tasks: this.tasks(date, nowMs, databases, phrasesDb),
      updatedAt: nowMs
    }
    if (next) briefing.events.tomorrowFirst = next
    return briefing
  }

  /**
   * The days `from` to `to` for the calendar screen: the events that overlap them and the open
   * tasks due on them. Calendars that are due are read in the background, as for the briefing;
   * one that holds nothing for days this far away is read once in full, and the windows hear
   * about it through `briefing:changed`.
   */
  async agenda(rawFrom: unknown, rawTo: unknown, force = false): Promise<BriefingAgenda> {
    const from = typeof rawFrom === 'string' ? localMidnight(rawFrom) : null
    const last = typeof rawTo === 'string' ? localMidnight(rawTo) : null
    if (from === null || last === null || last < from || last - from > BRIEFING_LIMITS.agendaDays * DAY_MS) throw new Error('Invalid days')
    // Local days are 23 to 25 hours long: the next midnight is found, not added.
    const to = startOfLocalDay(last + 26 * 3_600_000)
    const { calendars } = this.deps
    if (force) await calendars.refresh(true)
    else if (calendars.stale()) void calendars.refresh(false)
    let span = calendars.span(from, to)
    if (!span.complete) {
      if (force) {
        await calendars.cover(from, to)
        span = calendars.span(from, to)
      } else void calendars.cover(from, to)
    }
    const nowMs = this.now()
    const today = localDay(nowMs)
    const range = { from: localDay(from), to: localDay(last) }
    const databases = this.repo.listDatabases()
    const phrasesDb = this.phrasesDatabase(databases)
    const chosen = this.setting<string[] | null>('briefing.databases', null)
    const selected = selectTasks(this.taskBlocks(databases, phrasesDb, chosen), { today, databases: chosen, exclude: phrasesDb ? [phrasesDb.id] : [], range, cap: AGENDA_CAP })
    return { ...range, today, events: span.events, tasks: selected.dated ?? [], calendars: calendars.status(), complete: span.complete, updatedAt: nowMs }
  }

  /** The task databases the settings allow, each followed by its rows. */
  private taskBlocks(databases: Block[], phrasesDb: Block | null, chosen: readonly string[] | null): TaskBlock[] {
    const wanted = chosen ? new Set(chosen) : null
    const blocks: TaskBlock[] = []
    for (const database of databases) {
      if (database.id === phrasesDb?.id || (wanted && !wanted.has(database.id))) continue
      // Only databases that can say "done" have their rows loaded.
      if (!detectSignal(database.props)) continue
      blocks.push(database)
      for (const row of this.repo.children(database.id)) blocks.push(row)
    }
    return blocks
  }

  private tasks(date: string, nowMs: number, databases: Block[], phrasesDb: Block | null): Briefing['tasks'] {
    const chosen = this.setting<string[] | null>('briefing.databases', null)
    const includeNoDate = this.setting('briefing.includeNoDate', false)
    const includeTodos = this.setting('briefing.includeTodos', false)
    const maxItems = this.setting<number>('briefing.maxItems', BRIEFING_LIMITS.maxItems.default)
    const blocks = this.taskBlocks(databases, phrasesDb, chosen)
    const todoSince = nowMs - TODO_DAYS * DAY_MS
    if (includeTodos) {
      const seen = new Set(blocks.map((block) => block.id))
      for (const page of this.repo.listRecent(TODO_PAGES)) {
        if (page.type !== 'page' || page.updatedAt < todoSince) continue
        for (const block of this.repo.getTree(page.id)) {
          if (!seen.has(block.id)) {
            seen.add(block.id)
            blocks.push(block)
          }
        }
      }
    }
    const selected = selectTasks(blocks, {
      today: date,
      databases: chosen,
      exclude: phrasesDb ? [phrasesDb.id] : [],
      includeTodos,
      todoSince,
      cap: GROUP_CAP
    })
    const tasks: Briefing['tasks'] = { overdue: selected.overdue, today: selected.today, more: 0 }
    if (includeNoDate) tasks.noDate = selected.noDate
    const total = tasks.overdue.length + tasks.today.length + (tasks.noDate?.length ?? 0)
    tasks.more = Math.max(0, total - maxItems)
    return tasks
  }

  /** Databases the task list can draw from, most recently edited first (for the settings). */
  databases(): BriefingDatabase[] {
    const all = this.repo.listDatabases()
    const phrases = this.phrasesDatabase(all)
    const out: BriefingDatabase[] = []
    for (const database of all) {
      if (database.id === phrases?.id || out.length >= BRIEFING_LIMITS.databases) continue
      const entry: BriefingDatabase = { id: database.id, name: plainText(database.props.title).trim().slice(0, 120) || 'Untitled', detected: detectSignal(database.props) !== null }
      if (typeof database.props.icon === 'string') entry.icon = database.props.icon.slice(0, 16)
      out.push(entry)
    }
    return out
  }

  // ---- phrases --------------------------------------------------------------

  /** The database of the user's own phrases, when the one in the settings is still there. */
  private phrasesDatabase(databases: Block[]): Block | null {
    const id = this.setting<string | null>('briefing.phrasesDatabaseId', null)
    return (id && databases.find((database) => database.id === id)) || null
  }

  private candidates(phrasesDb: Block | null): { bundled: PhraseCandidate[]; own: PhraseCandidate[] } {
    const own = phrasesDb ? ownPhrases(phrasesDb, this.repo.children(phrasesDb.id)) : []
    return { bundled: QUOTES.map(fromQuote), own }
  }

  private phraseSettings(): { traditions: Tradition[] | null; own: OwnPhrases } {
    return { traditions: this.setting<Tradition[] | null>('briefing.traditions', null), own: this.setting<OwnPhrases>('briefing.ownPhrases', 'balanced') }
  }

  private static view(candidate: PhraseCandidate): BriefingPhrase {
    const { favourite: _favourite, ...phrase } = candidate
    return phrase
  }

  /** Today's phrase: the one already chosen for this day, or a new choice that is then remembered. */
  private phraseOfDay(date: string, phrasesDb: Block | null): BriefingPhrase | null {
    const { bundled, own } = this.candidates(phrasesDb)
    const stored = this.repo.getSetting<{ date?: unknown; id?: unknown; skip?: unknown }>(PHRASE_DAY_KEY)
    if (stored && stored.date === date && typeof stored.id === 'string') {
      const id = stored.id
      const kept = id.startsWith('own:') ? own.find((item) => item.id === id) : bundled.find((item) => item.id === id)
      if (kept) return BriefingService.view(kept)
    }
    const history = readHistory(this.repo.getSetting(PHRASE_HISTORY_KEY))
    const picked = pickPhrase({ date, bundled, own, history, settings: this.phraseSettings() })
    if (!picked) return null
    this.remember(date, picked.id, 0, history)
    return BriefingService.view(picked)
  }

  private remember(date: string, id: string, skip: number, history: ReturnType<typeof readHistory>): void {
    try {
      this.repo.setSetting(PHRASE_DAY_KEY, { date, id, skip })
      this.repo.setSetting(PHRASE_HISTORY_KEY, recordPhrase(history, date, id))
    } catch (err) {
      // The phrase is still shown; it may just come back sooner than it should.
      console.error('[briefing] could not remember the phrase of the day', err)
    }
  }

  /** A different phrase for today, at the user's request. It becomes the day's phrase. */
  anotherPhrase(): BriefingPhrase | null {
    const date = localDay(this.now())
    const phrasesDb = this.phrasesDatabase(this.repo.listDatabases())
    const { bundled, own } = this.candidates(phrasesDb)
    const stored = this.repo.getSetting<{ date?: unknown; id?: unknown; skip?: unknown }>(PHRASE_DAY_KEY)
    const sameDay = !!stored && stored.date === date
    const skip = sameDay && typeof stored.skip === 'number' && Number.isFinite(stored.skip) ? Math.min(100_000, Math.max(0, Math.floor(stored.skip))) + 1 : 1
    const current = sameDay && typeof stored.id === 'string' ? [stored.id] : []
    const history = readHistory(this.repo.getSetting(PHRASE_HISTORY_KEY))
    const picked = pickPhrase({ date, bundled, own, history, settings: this.phraseSettings(), skip, avoid: current })
    if (!picked) return null
    this.remember(date, picked.id, skip, history)
    return BriefingService.view(picked)
  }

  /**
   * The database of the user's own phrases: the one in the settings, else a database at the
   * top of the workspace called "Phrases", else a new one.
   */
  ensurePhrasesDatabase(): { id: string } {
    const databases = this.repo.listDatabases()
    const current = this.phrasesDatabase(databases)
    if (current) return { id: current.id }
    const named = databases.find((database) => database.parentId === null && plainText(database.props.title).trim().toLowerCase() === PHRASES_TITLE.toLowerCase())
    if (named) {
      this.repo.setSetting('briefing.phrasesDatabaseId', named.id)
      return { id: named.id }
    }
    const colors = ['blue', 'orange', 'green', 'purple', 'brown', 'pink', 'yellow']
    const schema: Record<string, PropertySchema> = {
      title: { id: 'title', name: 'Phrase', type: 'title' },
      author: { id: 'author', name: 'Author', type: 'text' },
      source: { id: 'source', name: 'Source', type: 'text' },
      tradition: {
        id: 'tradition',
        name: 'Tradition',
        type: 'select',
        options: TRADITIONS.map((name, index) => ({ id: name, name: TRADITION_LABELS[name], color: colors[index % colors.length] }))
      },
      favourite: { id: 'favourite', name: 'Favourite', type: 'checkbox' }
    }
    const order = ['title', 'author', 'source', 'tradition', 'favourite']
    const views: DatabaseView[] = [{ id: randomUUID(), name: 'Table', type: 'table', visibleProperties: order, filters: [], sorts: [] }]
    const created = this.repo.create({ type: 'database', parentId: null, props: { title: [[PHRASES_TITLE]], schema, views } })
    this.repo.setSetting('briefing.phrasesDatabaseId', created.id)
    return { id: created.id }
  }

  /** Copies a bundled quote into the user's phrases. Adding the same one twice gives the same row. */
  addPhrase(rawId: unknown): { id: string } {
    const quote = typeof rawId === 'string' && rawId.length <= 40 ? quoteById(rawId) : undefined
    if (!quote) throw new Error('That phrase is not in the collection.')
    const { id: databaseId } = this.ensurePhrasesDatabase()
    const database = this.repo.get(databaseId)
    if (!database || database.type !== 'database') throw new Error('The phrases database could not be opened.')
    const rows = this.repo.children(databaseId)
    const existing = rows.find((row) => row.type === 'page' && row.trashedAt === null && plainText(row.props.title).trim() === quote.text)
    if (existing) return { id: existing.id }
    const columns = phraseColumns(database.props)
    const values: Record<string, PropertyValue> = {}
    if (columns.author) values[columns.author] = quote.author
    if (columns.source) values[columns.source] = `${quote.work}, ${quote.locator}${quote.translator ? ` (tr. ${quote.translator})` : ''}`.slice(0, 300)
    if (columns.tradition) {
      const option = columns.traditions.get(quote.tradition)
      if (option) values[columns.tradition] = option
    }
    const row = this.repo.create({ type: 'page', parentId: databaseId, props: { title: [[quote.text]], values } })
    return { id: row.id }
  }

  // ---- tasks ----------------------------------------------------------------

  private pruneUndo(): void {
    const now = this.now()
    for (const [token, entry] of this.undo) if (now - entry.at > UNDO_TTL_MS) this.undo.delete(token)
    while (this.undo.size >= MAX_UNDO) {
      const oldest = this.undo.keys().next()
      if (oldest.done) break
      this.undo.delete(oldest.value)
    }
  }

  /**
   * Marks a task done where it lives: a row gets its checkbox ticked and / or its status moved
   * to the done option, a to-do block is checked. An ordinary write: history and change events
   * follow as for any edit. The token takes it back for ten minutes.
   */
  completeTask(rawId: unknown): { token: string; next?: string } {
    const id = arg.id(rawId, 'task')
    const block = this.repo.get(id)
    if (!block || block.trashedAt !== null) throw new Error('That task no longer exists.')
    this.pruneUndo()
    const token = randomUUID()
    if (block.type === 'to_do') {
      if (block.props.checked === true) throw new Error('That task is already done.')
      this.repo.update(id, { props: { checked: true } })
      this.undo.set(token, { id, at: this.now() })
      return { token }
    }
    const parent = block.type === 'page' && block.parentId ? this.repo.get(block.parentId) : null
    // The built-in Tasks database completes the way the Tasks screen does (a repeating task moves on).
    if (block.type === 'page' && systemKindOf(parent) === 'tasks') {
      const completion = completeTaskValues(block.props.values, new Date(this.now()))
      if (!completion) throw new Error('That task is already done.')
      this.repo.update(id, { props: { values: completion.values } as BlockProps })
      this.undo.set(token, { id, at: this.now(), previous: completion.previous })
      return completion.next ? { token, next: completion.next } : { token }
    }
    const signal = parent && parent.type === 'database' && typeof parent.props.sourceId !== 'string' ? detectSignal(parent.props) : null
    if (!signal) throw new Error('That task cannot be marked done from here.')
    const plan = planCompletion(signal, block.props)
    if (!plan) throw new Error('That task is already done.')
    this.repo.update(id, { props: { values: plan.values } as BlockProps })
    this.undo.set(token, { id, at: this.now(), previous: plan.previous })
    return { token }
  }

  undoCompleteTask(rawToken: unknown): void {
    const token = typeof rawToken === 'string' && rawToken.length <= 64 ? rawToken : ''
    this.pruneUndo()
    const entry = this.undo.get(token)
    if (!entry) throw new Error('That can no longer be undone.')
    this.undo.delete(token)
    const block = this.repo.get(entry.id)
    if (!block) throw new Error('That task no longer exists.')
    if (!entry.previous) this.repo.update(entry.id, { props: { checked: false } })
    else this.repo.update(entry.id, { props: { values: planUndo(block.props, entry.previous) } as BlockProps })
  }

  // ---- calendars ------------------------------------------------------------

  listCalendars(): BriefingCalendar[] {
    return this.deps.calendars.status()
  }

  /**
   * Connects a calendar. The address is checked, stored encrypted, and from here on it exists
   * only in this process: what goes back is the label and the host.
   */
  addCalendar(raw: unknown): BriefingCalendar {
    const input = arg.plainObject(raw, 'calendar')
    for (const key of Object.keys(input)) if (key !== 'label' && key !== 'url' && key !== 'color') throw new Error('Invalid calendar')
    if (typeof input['url'] !== 'string' || input['url'].length > BRIEFING_LIMITS.url) throw new Error(CALENDAR_ERROR_TEXT['blocked-address'])
    if (typeof input['label'] !== 'string' || input['label'].length > 200) throw new Error('Invalid calendar')
    if (!isCalendarColor(input['color'])) throw new Error('Invalid colour')
    try {
      const entry = this.deps.store.add({ label: input['label'], url: input['url'], color: input['color'] })
      return { ...entry, ok: true }
    } catch (err) {
      // The reason, in words; never what was typed.
      if (err instanceof CalendarError) throw new Error(CALENDAR_ERROR_TEXT[err.reason])
      throw err
    }
  }

  updateCalendar(rawId: unknown, raw: unknown): BriefingCalendar {
    const id = arg.id(rawId, 'calendar')
    const patch = arg.plainObject(raw, 'calendar')
    for (const key of Object.keys(patch)) if (key !== 'label' && key !== 'color' && key !== 'enabled') throw new Error('Invalid calendar')
    if (patch['label'] !== undefined && (typeof patch['label'] !== 'string' || patch['label'].length > 200)) throw new Error('Invalid calendar')
    this.deps.store.update(id, patch)
    const status = this.deps.calendars.status().find((entry) => entry.id === id)
    if (!status) throw new Error('That calendar is no longer connected.')
    return status
  }

  removeCalendar(rawId: unknown): void {
    const id = arg.id(rawId, 'calendar')
    this.deps.store.remove(id)
    this.deps.calendars.forget(id)
  }

  testCalendar(rawId: unknown): Promise<CalendarTestResult> {
    return this.deps.calendars.test(arg.id(rawId, 'calendar'))
  }

  // ---- "Brief me" -----------------------------------------------------------

  /** What the optional AI paragraph is written from: the agenda and the tasks, as lines of text. */
  promptData(): BriefingPromptData {
    const briefing = this.build()
    const now = new Date(this.now())
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
    const eventLine = (event: BriefingEvent): string => {
      const when = event.allDay ? 'All day' : event.end > event.start ? `${time.format(event.start)}–${time.format(event.end)}` : time.format(event.start)
      return `${when}: ${event.title || 'Untitled'}${event.location ? ` (${event.location})` : ''}`
    }
    const taskLine = (task: BriefingTask): string => `${task.title}${task.due ? ` (due ${task.due})` : ''}${task.priority ? ` [${task.priority.name}]` : ''}`
    const data: BriefingPromptData = {
      date: new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now),
      time: time.format(now),
      events: briefing.events.today.map(eventLine),
      overdue: briefing.tasks.overdue.map(taskLine),
      today: [...briefing.tasks.today, ...(briefing.tasks.noDate ?? [])].map(taskLine)
    }
    if (briefing.events.tomorrowFirst) data.tomorrow = eventLine(briefing.events.tomorrowFirst)
    return data
  }
}
