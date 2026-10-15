/**
 * Alarms: the times of day Herman briefs the user (with a sound, and aloud if they like), and
 * the reminders of tasks that carry a time. The main process keeps the clock (src/main/alarms):
 * it decides when, composes what is said from what the app already knows, and hands it to a
 * window, which plays the sound, shows Herman's bubble and speaks. Nothing is fetched for it,
 * and a model is asked only when the user turned the AI briefing on.
 *
 * Pure: no Electron, Node or React. Both sides and the tests import it.
 */

/** A time of day the briefing is given, on some days of the week. */
export interface AlarmTime {
  id: string
  /** `HH:mm`, local wall-clock time. */
  time: string
  /** Days of the week it rings on, 0 = Sunday. Empty means never. */
  days: number[]
  enabled: boolean
}

export interface AlarmSettings {
  times: AlarmTime[]
  /** A chime before he speaks. */
  sound: boolean
  /** He reads the briefing aloud with the system's voice. */
  voice: boolean
  /** The name of the system voice to use; null picks one of the briefing's language. */
  voiceName: string | null
  /** The briefing is written by the AI in his voice (falls back to his own words). */
  ai: boolean
  /** Tasks with a reminder or a due time are announced when it comes. */
  reminders: boolean
  /** sel keeps running in the notification area when its windows are closed, so alarms still ring. */
  tray: boolean
  /** sel starts with the system (in the notification area, when `tray` is on). */
  openAtLogin: boolean
}

export const ALARM_DEFAULTS: AlarmSettings = {
  times: [],
  sound: true,
  voice: true,
  voiceName: null,
  ai: false,
  reminders: true,
  tray: false,
  openAtLogin: false
}

export const MAX_ALARM_TIMES = 12

/** Something said at a moment the user chose: the briefing at one of its times, or a task's reminder. */
export interface Announcement {
  id: string
  kind: 'briefing' | 'reminder'
  /** What the bubble shows. */
  text: string
  /** What is read aloud (the same words, without what only reads well). */
  speech: string
  /** The language it is written in, for the voice. */
  locale: 'en' | 'pt-BR'
  sound: boolean
  voice: boolean
  voiceName: string | null
  /** The task to open from a reminder. */
  pageId?: string
  /** True when the text came from the AI. */
  ai?: boolean
  /** When it was due (ms). */
  at: number
}

export interface AlarmsApi {
  /** The announcement still waiting for a window, if any (a window opened for it asks once). */
  pending(): Promise<Announcement | null>
  /** The window has shown it: no other window needs to. */
  heard(id: string): Promise<void>
  /** Gives the briefing now, as it would be at its time ("Try it"). */
  test(): Promise<void>
  /** `alarms:announce`: something to say now. Returns an unsubscribe function. */
  onAnnounce(listener: (announcement: Announcement) => void): () => void
}

export const ALARMS_CHANNEL = 'alarms:announce'

// ---- settings -----------------------------------------------------------------

export const ALARMS_SETTING: Record<keyof AlarmSettings, string> = {
  times: 'alarms.times',
  sound: 'alarms.sound',
  voice: 'alarms.voice',
  voiceName: 'alarms.voiceName',
  ai: 'alarms.ai',
  reminders: 'alarms.reminders',
  tray: 'alarms.tray',
  openAtLogin: 'alarms.openAtLogin'
}

/** What the main process remembers: when each alarm and reminder last rang. Never written by a renderer. */
export const ALARMS_FIRED_KEY = 'alarms.fired'

/** The keys a renderer may write. None of them is synced: alarms belong to this device. */
export const ALARMS_KEYS = Object.values(ALARMS_SETTING)

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/

export function isAlarmTime(value: unknown): value is AlarmTime {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return (
    typeof raw['id'] === 'string' &&
    ID_RE.test(raw['id']) &&
    typeof raw['time'] === 'string' &&
    TIME_RE.test(raw['time']) &&
    Array.isArray(raw['days']) &&
    raw['days'].every((day) => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6) &&
    typeof raw['enabled'] === 'boolean'
  )
}

/** The list as stored, made safe: malformed entries go, days are sorted and unique, ids unique. */
export function cleanAlarmTimes(value: unknown): AlarmTime[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_ALARM_TIMES) return undefined
  const out: AlarmTime[] = []
  const ids = new Set<string>()
  for (const item of value) {
    if (!isAlarmTime(item)) return undefined
    if (ids.has(item.id)) return undefined
    ids.add(item.id)
    out.push({ id: item.id, time: item.time, days: [...new Set(item.days)].sort((a, b) => a - b), enabled: item.enabled })
  }
  return out
}

/** The value an alarms setting accepts from a renderer, or undefined when it does not. */
export function cleanAlarmsSetting(key: string, value: unknown): unknown {
  switch (key) {
    case ALARMS_SETTING.times:
      return cleanAlarmTimes(value)
    case ALARMS_SETTING.voiceName:
      return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined
    case ALARMS_SETTING.sound:
    case ALARMS_SETTING.voice:
    case ALARMS_SETTING.ai:
    case ALARMS_SETTING.reminders:
    case ALARMS_SETTING.tray:
    case ALARMS_SETTING.openAtLogin:
      return typeof value === 'boolean' ? value : undefined
    default:
      return undefined
  }
}

/** The settings as stored, each one its default when nothing valid is stored. */
export function readAlarmSettings(get: (key: string) => unknown): AlarmSettings {
  const out = { ...ALARM_DEFAULTS }
  for (const name of Object.keys(ALARMS_SETTING) as (keyof AlarmSettings)[]) {
    let stored: unknown
    try {
      stored = get(ALARMS_SETTING[name])
    } catch {
      stored = undefined
    }
    const clean = stored === null || stored === undefined ? undefined : cleanAlarmsSetting(ALARMS_SETTING[name], stored)
    if (clean !== undefined) (out as Record<string, unknown>)[name] = clean
  }
  return out
}
