import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { BRIEFING_LIMITS, cleanCalendarLabel as cleanLabel, isCalendarColor, type CalendarColor } from '../../shared/briefing'
import { calendarKey, CALENDAR_TOMBSTONES, type CalendarsFile, type CalendarSync, type CalendarTombstone } from '../sync/format'
import { hostOf, validateCalendarUrl, type NetPolicy } from './net'

/**
 * The calendars the user connected, and their addresses.
 *
 * SECURITY — a calendar's "secret address" is a credential: whoever has it can read the
 * calendar. It is therefore stored ONLY here, in one file under the profile directory,
 * encrypted with the operating system's key store (Electron `safeStorage`: DPAPI on Windows,
 * Keychain on macOS, the desktop keyring on Linux). It is never written to the settings table
 * or the database, never logged, and never handed back to a window after it was entered:
 * `list()` gives labels and host names only, and `urlOf()` is for the fetcher in this process.
 *
 * SYNC / EXPORT — this file itself stays out of any sync, backup-to-cloud or export feature:
 * it is tied to this computer's key store (it cannot be decrypted elsewhere anyway). What it
 * holds reaches another device one way only: sync, and only into a repository encrypted with
 * the user's passphrase (`exportForSync` / `importFromSync`, used through ./sync.ts by
 * ../sync/engine.ts, which never writes calendars into a repository that is not encrypted).
 *
 * Free of Electron imports: the cipher is passed in, so the storage rules can be unit-tested.
 */

/** What `safeStorage` offers; a test passes a stand-in. */
export interface Cipher {
  isAvailable(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

/** A calendar without its address: the only shape that leaves this module towards a window. */
export interface CalendarEntry {
  id: string
  label: string
  host: string
  color: CalendarColor
  enabled: boolean
}

interface StoredCalendar extends CalendarEntry {
  url: string
  /** When it was added or last changed, here or on a synced device (0: before this was kept). */
  updatedAt: number
}

interface Stored {
  calendars: StoredCalendar[]
  /** Calendars removed, by a hash of their address: so that sync removes them on the other devices too. */
  removed: CalendarTombstone[]
}

const FILE_VERSION = 1
/** A plain message for the user; it never names a file or an address. */
export const NO_KEY_STORE = 'This computer has no secure storage for the calendar address, so it cannot be saved.'

function stamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export class CalendarStore {
  private cache: Stored | null = null

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
    private readonly policy: () => NetPolicy = () => ({}),
    private readonly clock: () => number = Date.now
  ) {}

  private read(): StoredCalendar[] {
    return this.load().calendars
  }

  private load(): Stored {
    if (this.cache) return this.cache
    const out: StoredCalendar[] = []
    const removed: CalendarTombstone[] = []
    try {
      const raw = readFileSync(this.file)
      const parsed = JSON.parse(this.cipher.decrypt(raw)) as { version?: unknown; calendars?: unknown; removed?: unknown }
      if (parsed && parsed.version === FILE_VERSION && Array.isArray(parsed.removed)) {
        for (const item of parsed.removed as unknown[]) {
          if (removed.length >= CALENDAR_TOMBSTONES || !item || typeof item !== 'object') continue
          const entry = item as Partial<CalendarTombstone>
          if (typeof entry.key === 'string' && /^[0-9a-f]{64}$/.test(entry.key))
            removed.push({ key: entry.key, deletedAt: stamp(entry.deletedAt) })
        }
      }
      if (parsed && parsed.version === FILE_VERSION && Array.isArray(parsed.calendars)) {
        for (const item of parsed.calendars as unknown[]) {
          if (out.length >= BRIEFING_LIMITS.calendars || !item || typeof item !== 'object') continue
          const entry = item as Partial<StoredCalendar>
          if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.id) || typeof entry.url !== 'string') continue
          try {
            // What is on disk is checked like what is typed: a damaged file cannot widen the policy.
            const url = validateCalendarUrl(entry.url, this.policy())
            out.push({
              id: entry.id,
              label: cleanLabel(entry.label, hostOf(url)),
              host: hostOf(url),
              color: isCalendarColor(entry.color) ? entry.color : 'blue',
              enabled: entry.enabled !== false,
              url: url.href,
              updatedAt: stamp(entry.updatedAt)
            })
          } catch {
            /* an entry that no longer passes is dropped */
          }
        }
      }
    } catch {
      // No file yet, a file from another computer, or a key store that changed: no calendars.
    }
    this.cache = { calendars: out, removed }
    return this.cache
  }

  private write(calendars: StoredCalendar[], removed: CalendarTombstone[]): void {
    if (calendars.length === 0 && removed.length === 0) {
      // Nothing left to keep: no file, rather than an encrypted empty list.
      try {
        rmSync(this.file, { force: true })
      } catch {
        throw new Error('The calendar could not be removed.')
      }
      this.cache = { calendars: [], removed: [] }
      return
    }
    if (!this.cipher.isAvailable()) throw new Error(NO_KEY_STORE)
    const data = this.cipher.encrypt(JSON.stringify({ version: FILE_VERSION, calendars, removed }))
    mkdirSync(dirname(this.file), { recursive: true })
    const temp = `${this.file}.tmp`
    try {
      writeFileSync(temp, data, { mode: 0o600 })
      renameSync(temp, this.file)
    } catch {
      try {
        rmSync(temp, { force: true })
      } catch {
        /* nothing left to clean */
      }
      // The system's message would name the path: a plain one instead.
      throw new Error('The calendar could not be saved.')
    }
    this.cache = { calendars, removed }
  }

  /** The removals kept, without the one of `url` or, with `deletedAt`, with it as the newest. */
  private removals(url: string, deletedAt?: number): CalendarTombstone[] {
    const key = calendarKey(url)
    const rest = this.load().removed.filter((item) => item.key !== key)
    return deletedAt === undefined ? rest : [...rest, { key, deletedAt }].slice(-CALENDAR_TOMBSTONES)
  }

  private static view(entry: StoredCalendar): CalendarEntry {
    return { id: entry.id, label: entry.label, host: entry.host, color: entry.color, enabled: entry.enabled }
  }

  /** Whether any calendar is connected, without touching the key store when there is no file. */
  list(): CalendarEntry[] {
    return this.read().map(CalendarStore.view)
  }

  get(id: string): CalendarEntry | null {
    const entry = this.read().find((item) => item.id === id)
    return entry ? CalendarStore.view(entry) : null
  }

  /** Main process only: the address to fetch. Never pass the result towards a window or a log. */
  urlOf(id: string): string | null {
    return this.read().find((item) => item.id === id)?.url ?? null
  }

  add(input: { label: unknown; url: unknown; color: unknown }): CalendarEntry {
    if (!this.cipher.isAvailable()) throw new Error(NO_KEY_STORE)
    const calendars = this.read()
    if (calendars.length >= BRIEFING_LIMITS.calendars) throw new Error(`At most ${BRIEFING_LIMITS.calendars} calendars can be connected.`)
    // Throws a CalendarError('blocked-address'), whose message has nothing of the input in it.
    const url = validateCalendarUrl(input.url, this.policy())
    if (calendars.some((item) => item.url === url.href)) throw new Error('That calendar is already connected.')
    const entry: StoredCalendar = {
      id: randomUUID(),
      label: cleanLabel(input.label, hostOf(url)),
      host: hostOf(url),
      color: isCalendarColor(input.color) ? input.color : 'blue',
      enabled: true,
      url: url.href,
      updatedAt: this.clock()
    }
    this.write([...calendars, entry], this.removals(url.href))
    return CalendarStore.view(entry)
  }

  update(id: string, patch: { label?: unknown; color?: unknown; enabled?: unknown }): CalendarEntry {
    const calendars = this.read()
    const current = calendars.find((item) => item.id === id)
    if (!current) throw new Error('That calendar is no longer connected.')
    const next: StoredCalendar = { ...current, updatedAt: Math.max(this.clock(), current.updatedAt + 1) }
    if (patch.label !== undefined) next.label = cleanLabel(patch.label, current.host)
    if (patch.color !== undefined) {
      if (!isCalendarColor(patch.color)) throw new Error('Invalid colour')
      next.color = patch.color
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') throw new Error('Invalid calendar')
      next.enabled = patch.enabled
    }
    this.write(
      calendars.map((item) => (item.id === id ? next : item)),
      this.load().removed
    )
    return CalendarStore.view(next)
  }

  remove(id: string): void {
    const calendars = this.read()
    const current = calendars.find((item) => item.id === id)
    if (!current) return
    // Remembered for sync. Without a key store there is nowhere to remember it.
    const removed = this.cipher.isAvailable() ? this.removals(current.url, Math.max(this.clock(), current.updatedAt + 1)) : []
    this.write(
      calendars.filter((item) => item.id !== id),
      removed
    )
  }

  // ---- sync, main process only: these carry the addresses (see the note at the top).

  /** The calendars with their addresses, and the removals remembered. Null without a key store. */
  exportForSync(): Pick<CalendarsFile, 'calendars' | 'removed'> | null {
    if (!this.cipher.isAvailable()) return null
    const { calendars, removed } = this.load()
    return {
      calendars: calendars.map((entry) => ({
        url: entry.url,
        label: entry.label,
        color: entry.color,
        enabled: entry.enabled,
        updatedAt: entry.updatedAt
      })),
      removed: removed.map((item) => ({ ...item }))
    }
  }

  /**
   * Takes the calendars as a sync merged them (checked by ../sync/format.ts, and checked again
   * here). A calendar this device has keeps its id, so what was read from it stays valid.
   * Returns the ids of the calendars that are gone, or null when nothing could be stored.
   */
  importFromSync(merged: Pick<CalendarsFile, 'calendars' | 'removed'>): string[] | null {
    if (!this.cipher.isAvailable()) return null
    const current = this.load()
    const byUrl = new Map(current.calendars.map((entry) => [entry.url, entry]))
    const calendars: StoredCalendar[] = []
    const removed = merged.removed.slice(0, CALENDAR_TOMBSTONES).map((item) => ({ key: item.key, deletedAt: item.deletedAt }))
    for (const item of merged.calendars) {
      if (calendars.length >= BRIEFING_LIMITS.calendars) break
      let url: URL
      try {
        url = validateCalendarUrl(item.url, this.policy())
      } catch {
        continue
      }
      calendars.push({
        id: byUrl.get(url.href)?.id ?? randomUUID(),
        label: cleanLabel(item.label, hostOf(url)),
        host: hostOf(url),
        color: isCalendarColor(item.color) ? item.color : 'blue',
        enabled: item.enabled !== false,
        url: url.href,
        updatedAt: stamp(item.updatedAt)
      })
    }
    const kept = new Set(calendars.map((entry) => entry.id))
    const gone = current.calendars.filter((entry) => !kept.has(entry.id)).map((entry) => entry.id)
    // The order the user knows stays: the calendars this device had, then the new ones.
    const order = new Map(current.calendars.map((entry, at) => [entry.id, at]))
    calendars.sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size))
    if (JSON.stringify({ calendars, removed }) !== JSON.stringify(current)) this.write(calendars, removed)
    return gone
  }
}

/**
 * The store as the sync engine sees it. What a sync removed is forgotten by the calendar reader
 * too; without a key store the calendars are left out of sync on this device.
 */
export function calendarSync(store: CalendarStore, reader: { forget(id: string): void }, changed: () => void): CalendarSync {
  return {
    export: () => store.exportForSync(),
    import: (merged) => {
      const gone = store.importFromSync(merged)
      if (gone === null) return
      for (const id of gone) reader.forget(id)
      changed()
    },
    changed
  }
}
