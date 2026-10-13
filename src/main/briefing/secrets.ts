import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { BRIEFING_LIMITS, isCalendarColor, type CalendarColor } from '../../shared/briefing'
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
 * SYNC / EXPORT — this file must stay out of any sync, backup-to-cloud or export feature.
 * It is tied to this computer's key store (it cannot be decrypted elsewhere anyway) and it
 * holds credentials. A synced device connects its calendars again.
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
}

const FILE_VERSION = 1
/** A plain message for the user; it never names a file or an address. */
export const NO_KEY_STORE = 'This computer has no secure storage for the calendar address, so it cannot be saved.'

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  const label = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BRIEFING_LIMITS.label)
  return label || fallback
}

export class CalendarStore {
  private cache: StoredCalendar[] | null = null

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
    private readonly policy: () => NetPolicy = () => ({})
  ) {}

  private read(): StoredCalendar[] {
    if (this.cache) return this.cache
    const out: StoredCalendar[] = []
    try {
      const raw = readFileSync(this.file)
      const parsed = JSON.parse(this.cipher.decrypt(raw)) as { version?: unknown; calendars?: unknown }
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
              url: url.href
            })
          } catch {
            /* an entry that no longer passes is dropped */
          }
        }
      }
    } catch {
      // No file yet, a file from another computer, or a key store that changed: no calendars.
    }
    this.cache = out
    return out
  }

  private write(calendars: StoredCalendar[]): void {
    if (!this.cipher.isAvailable()) throw new Error(NO_KEY_STORE)
    const data = this.cipher.encrypt(JSON.stringify({ version: FILE_VERSION, calendars }))
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
    this.cache = calendars
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
      url: url.href
    }
    this.write([...calendars, entry])
    return CalendarStore.view(entry)
  }

  update(id: string, patch: { label?: unknown; color?: unknown; enabled?: unknown }): CalendarEntry {
    const calendars = this.read()
    const current = calendars.find((item) => item.id === id)
    if (!current) throw new Error('That calendar is no longer connected.')
    const next: StoredCalendar = { ...current }
    if (patch.label !== undefined) next.label = cleanLabel(patch.label, current.host)
    if (patch.color !== undefined) {
      if (!isCalendarColor(patch.color)) throw new Error('Invalid colour')
      next.color = patch.color
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') throw new Error('Invalid calendar')
      next.enabled = patch.enabled
    }
    this.write(calendars.map((item) => (item.id === id ? next : item)))
    return CalendarStore.view(next)
  }

  remove(id: string): void {
    const calendars = this.read()
    if (!calendars.some((item) => item.id === id)) return
    const rest = calendars.filter((item) => item.id !== id)
    if (rest.length === 0) {
      // Nothing left to keep: no file, rather than an encrypted empty list.
      try {
        rmSync(this.file, { force: true })
      } catch {
        throw new Error('The calendar could not be removed.')
      }
      this.cache = []
      return
    }
    this.write(rest)
  }
}
