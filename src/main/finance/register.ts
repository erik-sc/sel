import { defineFeature, type Registered } from '../feature'
import * as arg from '../validate'
import { asUser } from './store'

/**
 * The `finance:*` channels: what the Finance and household screens ask (shared/finance/api.ts).
 * A month comes already added up; whatever is entered goes through `finance:run`, which calls the
 * tools an app connected over MCP has, so one place checks it. Everything runs as the user
 * (`asUser`): "Private from AI" does not close the block to its own window.
 *
 * The tools and the arithmetic are loaded the first time a screen asks.
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/u

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
const localDay = (now: Date): string => `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

function monthArg(value: unknown, today: string): string {
  if (value === undefined || value === null) return today.slice(0, 7)
  const text = arg.text(value, 'month', 7)
  if (!MONTH_RE.test(text)) throw new Error('Invalid month')
  return text
}

/** The tools a window may run: the two blocks' own, and none of the workspace's. */
const RUNNABLE = /^(finance|split)_[a-z_]{1,40}$/u

export const financeFeature = defineFeature({
  namespace: 'finance',
  register: (ctx): Registered<'finance'> => ({
    handlers: {
      'finance:month': async ([month]) => {
        const today = localDay(new Date())
        const ref = monthArg(month, today)
        const { financeMonthView } = await import('./views')
        return asUser(() => financeMonthView(ctx.repo, ref, today))
      },
      'finance:household': async ([month]) => {
        const today = localDay(new Date())
        const ref = monthArg(month, today)
        const { householdView } = await import('./views')
        return asUser(() => householdView(ctx.repo, ref, today))
      },
      'finance:run': async ([tool, input]) => {
        const name = arg.text(tool, 'tool', 60)
        if (!RUNNABLE.test(name)) throw new Error('Unknown tool')
        const args = arg.plainObject(input ?? {}, 'args')
        const markdown = await import('../markdown')
        if (name.startsWith('split_')) {
          const { callSplitTool } = await import('../split/tools')
          return asUser(() => callSplitTool({ repo: ctx.repo, markdown }, name, args))
        }
        const { callFinanceTool } = await import('./tools')
        return asUser(() => callFinanceTool({ repo: ctx.repo, markdown }, name, args))
      }
    }
  })
})
