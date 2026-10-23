import { ACTIVITY_RHYTHM_KEY, ACTIVITY_RHYTHM_SAID_KEY, type ActivityKind, type ActivityRow, rhythmEnabled } from '../../shared/activity'
import type { HermanLocale, HermanNudge } from '../../shared/herman'
import { countsByProject, countsByWeekHour, filterRows, localTime, type LocalClock, weekOf } from './queries'

/**
 * The persona reads your rhythm (docs/plans/release-0.8.0.md, D4): once a week at most, and only
 * when turned on, one short and gentle observation drawn from the activity log's aggregates
 * ("your Tuesday mornings are when the writing happens; keep the next one for X?"). Worked out
 * here, without AI: no model is called, nothing leaves the computer. No score, no comparison
 * with a goal, no number at all: a weekday, a part of the day, a project's name.
 *
 * `observe` and the lines are pure; `weeklyRhythm` is the one the persona's service calls (see
 * main/herman/service.ts), with the settings and the log handed in, and it decides whether this
 * week's word is still due. Whether the persona may speak at this moment is the scheduler's.
 */

export const RHYTHM_KINDS = ['writing', 'done', 'focus'] as const
export type RhythmKind = (typeof RHYTHM_KINDS)[number]

export type DayPart = 'morning' | 'afternoon' | 'evening'
export const DAY_PARTS: readonly DayPart[] = ['morning', 'afternoon', 'evening']

/** Hours of each part of the day, `[from, to)`. The night is nobody's business. */
const PART_HOURS: Readonly<Record<DayPart, readonly [number, number]>> = {
  morning: [6, 12],
  afternoon: [12, 18],
  evening: [18, 23]
}

export function partOf(hour: number): DayPart | null {
  for (const part of DAY_PARTS) {
    const [from, to] = PART_HOURS[part]
    if (hour >= from && hour < to) return part
  }
  return null
}

/** The log as this module reads it: three `[weekday][hour]` grids (weekday 0 = Sunday). */
export interface RhythmFacts {
  /** Minutes with edits. */
  writing: readonly (readonly number[])[]
  /** Tasks completed. */
  done: readonly (readonly number[])[]
  /** Focus sessions started. */
  focus: readonly (readonly number[])[]
  /** The project with the most task events lately, by its name; null when none has any. */
  project: string | null
  /** How many whole weeks the log goes back. */
  weeks: number
}

/** How much there must be before anything is said: too little is noise, not a rhythm. */
export const RHYTHM_MIN = { weeks: 2, writing: 30, writingSlot: 6, done: 10, focus: 6, focusDay: 3 } as const
/** How far above an even spread a weekday or slot must stand out. */
export const RHYTHM_LIFT = 1.6
/** The share of completions one part of the day must hold. */
export const RHYTHM_DONE_SHARE = 0.5

export type RhythmObservation =
  | { kind: 'writing'; weekday: number; part: DayPart }
  | { kind: 'done'; part: DayPart }
  | { kind: 'focus'; weekday: number }

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)

/** `[weekday][part]` from a `[weekday][hour]` grid; hours outside the parts are left out. */
export function partsOf(grid: readonly (readonly number[])[]): number[][] {
  return Array.from({ length: 7 }, (_, weekday) =>
    DAY_PARTS.map((part) => {
      const [from, to] = PART_HOURS[part]
      return sum((grid[weekday] ?? []).slice(from, to))
    })
  )
}

function writingSlot(facts: RhythmFacts): RhythmObservation | null {
  const slots = partsOf(facts.writing)
  const total = sum(slots.flat())
  if (total < RHYTHM_MIN.writing) return null
  let best = { weekday: -1, part: 0, count: 0 }
  slots.forEach((parts, weekday) => {
    parts.forEach((count, part) => {
      if (count > best.count) best = { weekday, part, count }
    })
  })
  const even = total / (7 * DAY_PARTS.length)
  if (best.count < RHYTHM_MIN.writingSlot || best.count < even * RHYTHM_LIFT) return null
  return { kind: 'writing', weekday: best.weekday, part: DAY_PARTS[best.part] }
}

function donePart(facts: RhythmFacts): RhythmObservation | null {
  const byPart = DAY_PARTS.map((_, part) => sum(partsOf(facts.done).map((parts) => parts[part])))
  const total = sum(facts.done.map((hours) => sum(hours)))
  if (total < RHYTHM_MIN.done) return null
  const best = byPart.indexOf(Math.max(...byPart))
  if (byPart[best] / total < RHYTHM_DONE_SHARE) return null
  return { kind: 'done', part: DAY_PARTS[best] }
}

function focusDay(facts: RhythmFacts): RhythmObservation | null {
  const byDay = facts.focus.map((hours) => sum(hours))
  const total = sum(byDay)
  if (total < RHYTHM_MIN.focus) return null
  const best = byDay.indexOf(Math.max(...byDay))
  if (byDay[best] < RHYTHM_MIN.focusDay || byDay[best] < (total / 7) * RHYTHM_LIFT) return null
  return { kind: 'focus', weekday: best }
}

const FINDERS: Readonly<Record<RhythmKind, (facts: RhythmFacts) => RhythmObservation | null>> = {
  writing: writingSlot,
  done: donePart,
  focus: focusDay
}

/**
 * The one thing worth saying about the rhythm, or null. The kinds take turns: the one said last
 * week is tried last, so that the same remark does not come back every week.
 */
export function observe(facts: RhythmFacts, last: RhythmKind | null = null): RhythmObservation | null {
  if (facts.weeks < RHYTHM_MIN.weeks) return null
  const start = last ? (RHYTHM_KINDS.indexOf(last) + 1) % RHYTHM_KINDS.length : 0
  for (let i = 0; i < RHYTHM_KINDS.length; i++) {
    const found = FINDERS[RHYTHM_KINDS[(start + i) % RHYTHM_KINDS.length]](facts)
    if (found) return found
  }
  return null
}

// ---- words ------------------------------------------------------------------------

/** pt-BR weekdays: the name, "on Tuesdays", and "the next one" (sábado and domingo are masculine). */
const PT_DAYS: readonly { name: string; on: string; next: string }[] = [
  { name: 'domingo', on: 'aos domingos', next: 'o próximo' },
  { name: 'segunda', on: 'às segundas', next: 'a próxima' },
  { name: 'terça', on: 'às terças', next: 'a próxima' },
  { name: 'quarta', on: 'às quartas', next: 'a próxima' },
  { name: 'quinta', on: 'às quintas', next: 'a próxima' },
  { name: 'sexta', on: 'às sextas', next: 'a próxima' },
  { name: 'sábado', on: 'aos sábados', next: 'o próximo' }
]
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const PT_PARTS: Readonly<Record<DayPart, { plural: string; when: string }>> = {
  morning: { plural: 'manhãs', when: 'de manhã' },
  afternoon: { plural: 'tardes', when: 'à tarde' },
  evening: { plural: 'noites', when: 'à noite' }
}
const EN_PARTS: Readonly<Record<DayPart, { plural: string; when: string }>> = {
  morning: { plural: 'mornings', when: 'in the morning' },
  afternoon: { plural: 'afternoons', when: 'in the afternoon' },
  evening: { plural: 'evenings', when: 'in the evening' }
}

const PROJECT_CHARS = 40

/** A project's name as it may appear in a line: one line, no quotes, capped. */
export function tidyProject(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202f]+/g, ' ')
    .replace(/[\u201c\u201d"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return null
  return clean.length > PROJECT_CHARS ? `${clean.slice(0, PROJECT_CHARS - 1).trimEnd()}…` : clean
}

/** The observation in words. Neutral to the persona's name: it speaks for itself. */
export function rhythmText(observation: RhythmObservation, rawProject: string | null, locale: HermanLocale): string {
  const project = tidyProject(rawProject)
  if (locale === 'pt-BR') {
    switch (observation.kind) {
      case 'writing': {
        const lead = `Suas ${PT_PARTS[observation.part].plural} de ${PT_DAYS[observation.weekday].name} rendem para escrever.`
        return project ? `${lead} Quer guardar a próxima para ${project}?` : `${lead} Vale deixar a próxima livre?`
      }
      case 'done':
        return `Quase tudo o que você conclui, conclui ${PT_PARTS[observation.part].when}. Talvez seja o trecho do dia para proteger.`
      case 'focus': {
        const day = PT_DAYS[observation.weekday]
        const lead = `Seus focos costumam se juntar ${day.on}.`
        return project ? `${lead} Quer guardar ${day.next} para ${project}?` : `${lead} Bom saber na hora de planejar a semana.`
      }
    }
  }
  switch (observation.kind) {
    case 'writing': {
      const lead = `Your ${EN_DAYS[observation.weekday]} ${EN_PARTS[observation.part].plural} seem to be when the writing happens.`
      return project ? `${lead} Want to keep the next one for ${project}?` : `${lead} Worth keeping the next one clear?`
    }
    case 'done':
      return `Most of what you finish, you finish ${EN_PARTS[observation.part].when}. Maybe that is the stretch to protect.`
    case 'focus': {
      const day = EN_DAYS[observation.weekday]
      const lead = `Your focus sessions tend to gather on ${day}s.`
      return project ? `${lead} Want to keep the next one for ${project}?` : `${lead} Good to know when planning the week.`
    }
  }
}

const SEE_FLOWS: Readonly<Record<HermanLocale, string>> = { en: 'See flows', 'pt-BR': 'Ver fluxos' }

// ---- the weekly word -----------------------------------------------------------------

const WEEK = 7 * 24 * 60 * 60_000
/** How far back the rhythm is read: recent enough to be today's rhythm, long enough to be one. */
export const RHYTHM_WEEKS = 6

/** The grids and the project, from rows of the log. */
export function rhythmFacts(
  rows: readonly ActivityRow[],
  oldest: number | null,
  now: number,
  projectName: (id: string) => string | null,
  local: LocalClock = localTime
): RhythmFacts {
  const grid = (kinds: ActivityKind[]): number[][] => countsByWeekHour(filterRows(rows, { kinds }), local)
  const top = countsByProject(rows).find((entry) => entry.project !== null)
  return {
    writing: grid(['edit']),
    done: grid(['task.completed']),
    focus: grid(['focus.start']),
    project: top?.project ? projectName(top.project) : null,
    weeks: oldest === null ? 0 : Math.floor(Math.max(0, now - oldest) / WEEK)
  }
}

/** What is remembered of the last week a word was due: its Monday, and what was said (null: nothing was). */
export interface RhythmSaid {
  week: string
  kind: RhythmKind | null
}

export function readSaid(raw: unknown): RhythmSaid | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const week = value['week']
  if (typeof week !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(week)) return null
  const kind = value['kind']
  return { week, kind: typeof kind === 'string' && (RHYTHM_KINDS as readonly string[]).includes(kind) ? (kind as RhythmKind) : null }
}

/** True when this week (local, from Monday) has not had its look at the rhythm yet. */
export function rhythmDue(said: RhythmSaid | null, now: number): boolean {
  return !said || said.week !== weekOf(now)
}

export interface RhythmContext {
  getSetting(key: string): unknown
  setSetting(key: string, value: unknown): void
  /** The activity log is on. */
  logEnabled(): boolean
  /** Its rows between two moments, and its oldest moment (see db/activity.ts). */
  rows(from: number, to: number): ActivityRow[]
  oldest(): number | null
  /** A project's name from its option id (the Tasks database's Project property). */
  projectName(id: string): string | null
  now: number
  locale: HermanLocale
}

export interface RhythmLine {
  kind: RhythmKind
  text: string
  action: NonNullable<HermanNudge['action']>
}

/**
 * This week's word about the rhythm, or null: when the setting is off (the default), the log is
 * off, the week already had its look, or there is nothing worth saying. Called only when the
 * persona may speak right now, so a line returned is a line said: the week is marked then. A week
 * with nothing to say is marked too, so that the log is read once a week, not at every chance.
 */
export function weeklyRhythm(ctx: RhythmContext): RhythmLine | null {
  if (!rhythmEnabled(ctx.getSetting(ACTIVITY_RHYTHM_KEY)) || !ctx.logEnabled()) return null
  const said = readSaid(ctx.getSetting(ACTIVITY_RHYTHM_SAID_KEY))
  if (!rhythmDue(said, ctx.now)) return null
  const rows = ctx.rows(ctx.now - RHYTHM_WEEKS * WEEK, ctx.now + 1)
  const facts = rhythmFacts(rows, ctx.oldest(), ctx.now, ctx.projectName)
  const observation = observe(facts, said?.kind ?? null)
  ctx.setSetting(ACTIVITY_RHYTHM_SAID_KEY, { week: weekOf(ctx.now), kind: observation?.kind ?? said?.kind ?? null })
  if (!observation) return null
  return {
    kind: observation.kind,
    text: rhythmText(observation, facts.project, ctx.locale),
    action: { label: SEE_FLOWS[ctx.locale], command: { type: 'open-flows' } }
  }
}
