// The value of any cell, including what other rows contribute to it.
//
// `getCellValue` (./values.ts) reads what a row stores. Some property types are more than
// that: a relation only shows the linked rows that still exist, and a rollup is computed
// from them. Views, filters, sorts and exports read cells through `readCell` and
// `cellText`, which take the `CellContext` such types need. A new type whose value
// depends on other blocks is wired in here (and in `filterTypeOf` when it filters like
// another type). A formula reads its database's schema through the context too.
import type { Block, PropertySchema, PropertyType, PropertyValue } from '../../../../shared/types'
import { formatDate, type FormatOptions } from './dates'
import { computeFormula, formulaCellValue, formulaText, formulaValueType } from './formula'
import { linkedIds, linkedTitles, type CellContext } from './relation'
import { computeRollup, rollupValue, rollupValueType } from './rollup'
import { formatNumber, formatValue, getCellValue, type Schema } from './values'

/**
 * The value of a cell. Without a context a relation gives every id it stores and a
 * rollup or a formula gives null; with one, a relation gives the ids of the rows it shows,
 * a rollup its result (a number, a date or the original values as text) and a formula
 * its result (a number, text, true / false or a date; null when it fails).
 */
export function readCell(row: Block, prop: PropertySchema, ctx?: CellContext): PropertyValue {
  switch (prop.type) {
    case 'relation':
      return ctx ? linkedIds(row, prop, ctx) : getCellValue(row, prop)
    case 'rollup':
      return ctx ? rollupValue(computeRollup(row, prop, ctx)) : null
    case 'formula':
      return ctx ? formulaCellValue(computeFormula(row, prop, ctx)) : null
    default:
      return getCellValue(row, prop)
  }
}

/** A cell as plain text: titles of the linked rows for a relation, the formatted result for a rollup or a formula. */
export function cellText(row: Block, prop: PropertySchema, ctx?: CellContext, opts: FormatOptions = {}): string {
  if (prop.type === 'relation' && ctx) return linkedTitles(row, prop, ctx).join(', ')
  if (prop.type === 'formula') return ctx ? formulaText(computeFormula(row, prop, ctx, { locale: opts.locale }), opts) : ''
  if (prop.type === 'rollup') {
    const result = ctx ? computeRollup(row, prop, ctx) : null
    if (!result) return ''
    if (result.kind === 'number') return result.value === null ? '' : formatNumber(result.value, result.format, opts)
    if (result.kind === 'date') return result.value ? formatDate(result.value, opts) : ''
    return result.items.map((item) => item.text).join(', ')
  }
  return formatValue(getCellValue(row, prop), prop, opts)
}

/**
 * The type whose filter operators and sort order a property uses: its own, except for a
 * rollup or a formula, which filter and sort as what they give (a number, a date, text, or
 * true / false for a formula). A formula's result type depends on the properties it reads:
 * without `schema` it counts as text.
 */
export function filterTypeOf(prop: PropertySchema, schema?: Schema): PropertyType {
  if (prop.type === 'rollup') return rollupValueType(prop.rollup)
  if (prop.type === 'formula') return formulaValueType(prop, schema)
  return prop.type
}
