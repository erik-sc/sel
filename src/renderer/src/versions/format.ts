// Words for the version timeline: times, days, kinds, sizes. Pure; unit tested.
import type { VersionInfo, VersionKind } from '@shared/versions'

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const SHORT_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** "14:32" */
export function timeLabel(ms: number): string {
  return TIME.format(new Date(ms))
}

/** Local calendar day, as a sortable key. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(ms: number, now: number): number {
  const a = new Date(ms)
  const b = new Date(now)
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  // Rounded: a day is 23 or 25 hours long when the clocks change.
  return Math.round((startB - startA) / 86_400_000)
}

/** "Today", "Yesterday", "Monday 12 October", or "12 October 2025" for another year. */
export function dayLabel(ms: number, now: number): string {
  const days = daysBetween(ms, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const date = new Date(ms)
  return date.getFullYear() === new Date(now).getFullYear() ? DAY.format(date) : DAY_YEAR.format(date)
}

/** A moment in as few words as it takes: "14:32" today, "12 Oct, 14:32" this year, "12 Oct 2025, 14:32" otherwise. */
export function stampLabel(ms: number, now: number): string {
  const date = new Date(ms)
  if (daysBetween(ms, now) === 0) return timeLabel(ms)
  const day = date.getFullYear() === new Date(now).getFullYear() ? SHORT.format(date) : SHORT_YEAR.format(date)
  return `${day}, ${timeLabel(ms)}`
}

export interface DayGroup {
  key: string
  label: string
  items: VersionInfo[]
}

/** Versions (newest first) grouped by local calendar day, keeping their order. */
export function groupByDay(versions: VersionInfo[], now: number): DayGroup[] {
  const groups: DayGroup[] = []
  for (const version of versions) {
    const key = dayKey(version.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(version)
    else groups.push({ key, label: dayLabel(version.createdAt, now), items: [version] })
  }
  return groups
}

/** The badge of a version. A `daily` one is an automatic version that outlived its day. */
export function kindLabel(kind: VersionKind): string {
  if (kind === 'manual') return 'Saved'
  if (kind === 'restore') return 'Before restore'
  if (kind === 'sync') return 'Sync'
  return 'Auto'
}

/** Badge colour class suffix. */
export function kindTone(kind: VersionKind): 'auto' | 'saved' | 'restore' {
  if (kind === 'manual') return 'saved'
  if (kind === 'restore' || kind === 'sync') return 'restore'
  return 'auto'
}

export function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

/** "0 KB", "340 KB", "1.2 MB", "2.4 GB" */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
