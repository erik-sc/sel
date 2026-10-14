// The calculations of a "Calculations" view, as they are stored: a name, a formula and how
// the result is written. Only their shape is decided here; what a formula means is the
// engine's business (logic/calc.ts, loaded with the view).
import type { ViewCalc } from '@shared/types'
import { MAX_NAME_LENGTH, isSafeKey, orderedProperties, type Schema } from './values'

export const CALC_FORMATS: readonly NonNullable<ViewCalc['format']>[] = ['number', 'currency', 'percent']
/** Calculations one view holds. */
export const MAX_CALCS = 24
export const MAX_FORMULA_LENGTH = 400

/** A property's name as a formula refers to it: bare when it is one plain word, quoted otherwise. */
export function calcRef(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? name : `"${name.replace(/"/g, "'")}"`
}

/**
 * The calculations in `raw` that are well-formed, with unique ids. Null when `raw` is not a
 * list at all (the view then has none of its own).
 */
export function sanitizeCalcs(raw: unknown): ViewCalc[] | null {
  if (!Array.isArray(raw)) return null
  const out: ViewCalc[] = []
  const seen = new Set<string>()
  for (const item of raw as unknown[]) {
    if (out.length >= MAX_CALCS) break
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const { id, name, formula, format } = item as Record<string, unknown>
    if (!isSafeKey(id) || seen.has(id) || typeof formula !== 'string') continue
    seen.add(id)
    const calc: ViewCalc = { id, name: typeof name === 'string' ? name.slice(0, MAX_NAME_LENGTH) : '', formula: formula.slice(0, MAX_FORMULA_LENGTH) }
    if ((CALC_FORMATS as readonly unknown[]).includes(format)) calc.format = format as ViewCalc['format']
    out.push(calc)
  }
  return out
}

/**
 * What a new calculations view starts with: the total of the first number property, or the
 * number of rows when there is none. Ids are positional, so that two repairs of the same
 * view agree.
 */
export function defaultCalcs(schema: Schema): ViewCalc[] {
  const number = orderedProperties(schema).find((prop) => prop.type === 'number')
  if (number) return [{ id: 'calc-0', name: `Total ${number.name}`.slice(0, MAX_NAME_LENGTH), formula: `sum(${calcRef(number.name)})` }]
  return [{ id: 'calc-0', name: 'Count', formula: 'count()' }]
}
