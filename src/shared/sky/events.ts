// Rare nights: things that happen in the sky without the user doing anything. Pure: the chance is the
// date itself (rng('sel-sky-event:' + day)), so a day gives the same night on every computer and nothing
// is stored. At most one event a night; the calendar ones come first.

import type { Hemisphere } from './index'
import { rng } from './random'
import { isFullMoonNight } from './moon'

export type MeteorShower = 'quadrantids' | 'lyrids' | 'eta-aquariids' | 'delta-aquariids' | 'perseids' | 'orionids' | 'leonids' | 'geminids'
/** The season a solstice or equinox opens, for the hemisphere it is seen from. */
export type SeasonMark = 'spring-equinox' | 'summer-solstice' | 'autumn-equinox' | 'winter-solstice'

export type SkyEvent =
  | { kind: 'eclipse'; total: boolean }
  | { kind: 'anniversary' }
  | { kind: 'meteors'; shower: MeteorShower }
  | { kind: 'season'; mark: SeasonMark }
  | { kind: 'new-year' }
  | { kind: 'comet'; night: number }
  | { kind: 'halo' }
  | { kind: 'fireflies' }
  | { kind: 'flock' }
  | { kind: 'shooting-star' }
  | { kind: 'satellite' }
  | { kind: 'cloud' }

export type SkyEventKind = SkyEvent['kind']

export interface EventContext {
  hemisphere: Hemisphere
  /** The day of the very first Meditation, if there is one. */
  firstStarDay: string | null
}

/** Meteor showers on fixed nights ('MM-DD'): about thirteen a year. */
export const METEOR_NIGHTS: Readonly<Record<string, MeteorShower>> = {
  '01-03': 'quadrantids',
  '01-04': 'quadrantids',
  '04-22': 'lyrids',
  '05-05': 'eta-aquariids',
  '05-06': 'eta-aquariids',
  '07-29': 'delta-aquariids',
  '07-30': 'delta-aquariids',
  '08-12': 'perseids',
  '08-13': 'perseids',
  '10-21': 'orionids',
  '11-17': 'leonids',
  '12-13': 'geminids',
  '12-14': 'geminids'
}

/**
 * Partial and total lunar eclipses, 2026–2040, at the instant of greatest eclipse (TD, within a minute
 * of UTC). Checked on 2026-10-15 against NASA's catalogue (eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html
 * and LEdecade2031.html). Penumbral eclipses are left out: the moon barely changes.
 */
export const LUNAR_ECLIPSES: ReadonlyArray<readonly [string, 'total' | 'partial']> = [
  ['2026-03-03T11:35Z', 'total'],
  ['2026-08-28T04:14Z', 'partial'],
  ['2028-01-12T04:14Z', 'partial'],
  ['2028-07-06T18:21Z', 'partial'],
  ['2028-12-31T16:53Z', 'total'],
  ['2029-06-26T03:23Z', 'total'],
  ['2029-12-20T22:43Z', 'total'],
  ['2030-06-15T18:35Z', 'partial'],
  ['2032-04-25T15:15Z', 'total'],
  ['2032-10-18T19:04Z', 'total'],
  ['2033-04-14T19:14Z', 'total'],
  ['2033-10-08T10:56Z', 'total'],
  ['2034-09-28T02:48Z', 'partial'],
  ['2035-08-19T01:12Z', 'partial'],
  ['2036-02-11T22:13Z', 'total'],
  ['2036-08-07T02:53Z', 'total'],
  ['2037-01-31T14:02Z', 'total'],
  ['2037-07-27T04:10Z', 'partial'],
  ['2039-06-06T18:54Z', 'partial'],
  ['2039-11-30T16:56Z', 'partial'],
  ['2040-05-26T11:46Z', 'total'],
  ['2040-11-18T19:05Z', 'total']
]

/**
 * Equinoxes and solstices 2026–2040 (UTC): March equinox, June solstice, September equinox, December
 * solstice. From F. Espenak's table (astropixels.com/ephemeris/soleq2001.html), which follows the USNO;
 * the USNO's own service could not be reached on 2026-10-15, so every instant was also recomputed with
 * Meeus (Astronomical Algorithms, ch. 27) and agrees to within two minutes.
 */
export const SEASONS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['2026-03-20T14:46Z', '2026-06-21T08:25Z', '2026-09-23T00:06Z', '2026-12-21T20:50Z'],
  ['2027-03-20T20:25Z', '2027-06-21T14:11Z', '2027-09-23T06:02Z', '2027-12-22T02:43Z'],
  ['2028-03-20T02:17Z', '2028-06-20T20:02Z', '2028-09-22T11:45Z', '2028-12-21T08:20Z'],
  ['2029-03-20T08:01Z', '2029-06-21T01:48Z', '2029-09-22T17:37Z', '2029-12-21T14:14Z'],
  ['2030-03-20T13:51Z', '2030-06-21T07:31Z', '2030-09-22T23:27Z', '2030-12-21T20:09Z'],
  ['2031-03-20T19:41Z', '2031-06-21T13:17Z', '2031-09-23T05:15Z', '2031-12-22T01:56Z'],
  ['2032-03-20T01:23Z', '2032-06-20T19:09Z', '2032-09-22T11:11Z', '2032-12-21T07:57Z'],
  ['2033-03-20T07:23Z', '2033-06-21T01:01Z', '2033-09-22T16:52Z', '2033-12-21T13:45Z'],
  ['2034-03-20T13:18Z', '2034-06-21T06:45Z', '2034-09-22T22:41Z', '2034-12-21T19:35Z'],
  ['2035-03-20T19:03Z', '2035-06-21T12:33Z', '2035-09-23T04:39Z', '2035-12-22T01:31Z'],
  ['2036-03-20T01:02Z', '2036-06-20T18:31Z', '2036-09-22T10:23Z', '2036-12-21T07:12Z'],
  ['2037-03-20T06:50Z', '2037-06-21T00:22Z', '2037-09-22T16:13Z', '2037-12-21T13:08Z'],
  ['2038-03-20T12:40Z', '2038-06-21T06:09Z', '2038-09-22T22:02Z', '2038-12-21T19:01Z'],
  ['2039-03-20T18:32Z', '2039-06-21T11:58Z', '2039-09-23T03:50Z', '2039-12-22T00:41Z'],
  ['2040-03-20T00:11Z', '2040-06-20T17:46Z', '2040-09-22T09:44Z', '2040-12-21T06:33Z']
]

const NORTH_MARKS: readonly SeasonMark[] = ['spring-equinox', 'summer-solstice', 'autumn-equinox', 'winter-solstice']
const SOUTH_MARKS: readonly SeasonMark[] = ['autumn-equinox', 'winter-solstice', 'spring-equinox', 'summer-solstice']

/** The local calendar day an instant falls on, on this computer. */
export function localDayOf(iso: string): string {
  const d = new Date(iso)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

let eclipseDays: Map<string, boolean> | null = null
let seasonDays: Map<string, number> | null = null
let tablesZone = ''

/** The tables are UTC instants; the night they belong to depends on this computer's time zone. */
function tables(): { eclipses: Map<string, boolean>; seasons: Map<string, number> } {
  const zone = String(new Date(2026, 0, 1).getTimezoneOffset()) + '/' + String(new Date(2026, 6, 1).getTimezoneOffset())
  if (!eclipseDays || !seasonDays || zone !== tablesZone) {
    eclipseDays = new Map(LUNAR_ECLIPSES.map(([iso, type]) => [localDayOf(iso), type === 'total']))
    seasonDays = new Map()
    for (const row of SEASONS) row.forEach((iso, i) => seasonDays!.set(localDayOf(iso), i))
    tablesZone = zone
  }
  return { eclipses: eclipseDays, seasons: seasonDays }
}

/** Calendar seasons by month (1–12), for the hemisphere. */
export function seasonOf(day: string, hemisphere: Hemisphere): 'summer' | 'autumn' | 'winter' | 'spring' {
  const m = Number(day.slice(5, 7))
  const north = m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn'
  if (hemisphere === 'north') return north
  return ({ winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' } as const)[north]
}

/** The rainy months, when a cloud is likelier: the southern summer (Dec–Mar) or the northern one (Jun–Sep). */
export function isRainyMonth(day: string, hemisphere: Hemisphere): boolean {
  const m = Number(day.slice(5, 7))
  return hemisphere === 'south' ? m === 12 || m <= 3 : m >= 6 && m <= 9
}

const DAY_MS = 86_400_000

export function addDays(day: string, n: number): string {
  const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + n * DAY_MS
  return new Date(t).toISOString().slice(0, 10)
}

/** The draws of a night, in a fixed order, one per chance event. */
function draws(day: string): {
  comet: number
  halo: number
  fireflies: number
  flock: number
  shooting: number
  satellite: number
  cloud: number
} {
  const r = rng('sel-sky-event:' + day)
  return { comet: r(), halo: r(), fireflies: r(), flock: r(), shooting: r(), satellite: r(), cloud: r() }
}

const COMET_NIGHTS = 7
const COMET_GAP = 120
const cometMemo = new Map<string, boolean>()

/** A comet arrives on `day`: a 1-in-365 draw, and no other comet arrived in the 120 days before. */
export function isCometArrival(day: string): boolean {
  const known = cometMemo.get(day)
  if (known !== undefined) return known
  let arrives = draws(day).comet < 1 / 365
  if (arrives) {
    for (let i = 1; i <= COMET_GAP; i++) {
      if (isCometArrival(addDays(day, -i))) {
        arrives = false
        break
      }
    }
  }
  cometMemo.set(day, arrives)
  return arrives
}

/** Which night of a comet's visit `day` is (0 = the night it arrives), or null. */
export function cometNight(day: string): number | null {
  for (let i = 0; i < COMET_NIGHTS; i++) if (isCometArrival(addDays(day, -i))) return i
  return null
}

function sameDate(day: string, first: string): boolean {
  if (day <= first) return false
  const md = first.slice(5)
  const year = Number(day.slice(0, 4))
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  // a first star on 29 February has its birthday on the 28th in the other years
  return day.slice(5) === (md === '02-29' && !leap ? '02-28' : md)
}

/** The event of a night, or null for an ordinary one. */
export function eventOf(day: string, ctx: EventContext): SkyEvent | null {
  const { eclipses, seasons } = tables()
  const eclipse = eclipses.get(day)
  if (eclipse !== undefined) return { kind: 'eclipse', total: eclipse }
  if (ctx.firstStarDay && sameDate(day, ctx.firstStarDay)) return { kind: 'anniversary' }
  const shower = METEOR_NIGHTS[day.slice(5)]
  if (shower) return { kind: 'meteors', shower }
  const season = seasons.get(day)
  if (season !== undefined) return { kind: 'season', mark: (ctx.hemisphere === 'north' ? NORTH_MARKS : SOUTH_MARKS)[season] }
  if (day.slice(5) === '01-01') return { kind: 'new-year' }

  const comet = cometNight(day)
  if (comet !== null) return { kind: 'comet', night: comet }
  const d = draws(day)
  if (isFullMoonNight(day) && d.halo < 1 / 3) return { kind: 'halo' }
  const season4 = seasonOf(day, ctx.hemisphere)
  if (season4 === 'summer' && d.fireflies < 1 / 15) return { kind: 'fireflies' }
  if (season4 === 'autumn' && d.flock < 1 / 40) return { kind: 'flock' }
  if (d.shooting < 1 / 45) return { kind: 'shooting-star' }
  if (d.satellite < 1 / 60) return { kind: 'satellite' }
  if (d.cloud < (isRainyMonth(day, ctx.hemisphere) ? 1 / 30 : 1 / 40)) return { kind: 'cloud' }
  return null
}

/** What passes and plays once a day when the Sky opens; the rest is simply how that night is drawn. */
export function isPassing(event: SkyEvent): boolean {
  switch (event.kind) {
    case 'meteors':
    case 'shooting-star':
    case 'satellite':
    case 'cloud':
    case 'flock':
    case 'new-year':
    case 'eclipse':
    case 'season':
      return true
    default:
      return false
  }
}
