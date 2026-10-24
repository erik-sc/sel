/**
 * The `screens` block of a pull request's body: which scenarios the screenshot job captures.
 * Pure, and free of relative imports, so that Node 24 runs this file directly (type stripping)
 * before anything is installed: the workflow's first step is `node e2e/screens/block.ts`.
 *
 * The block is the first fenced block whose info string is `screens`. One scenario per line,
 * `<id>: <free text>`; only the id is read, blank lines are skipped. A line `all` means every
 * registered scenario.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

export interface ScreensBlock {
  /** Ids in the order written, without duplicates. Holds `all` when a line said so. */
  ids: string[]
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*screens\s*$/

/** The block in a body, or null when there is none. */
export function parseBlock(body: string | null | undefined): ScreensBlock | null {
  if (!body) return null
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  let fence = ''
  for (; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i] ?? '')
    if (open) {
      fence = open[1] ?? '```'
      break
    }
  }
  if (!fence) return null
  const ids: string[] = []
  for (i++; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim()
    if (line.length >= fence.length && line === fence.charAt(0).repeat(line.length)) break
    if (line === '') continue
    const colon = line.indexOf(':')
    const id = (colon === -1 ? line : line.slice(0, colon)).trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return { ids }
}

/** Two blocks ask for the same captures. */
export function sameBlock(a: ScreensBlock | null, b: ScreensBlock | null): boolean {
  if (a === null || b === null) return a === b
  return a.ids.length === b.ids.length && a.ids.every((id, n) => b.ids[n] === id)
}

/** What a pull_request event asks the job to do. */
export interface Plan {
  /** True when there is a block and it is worth capturing: not an edit that left the block as it was. */
  capture: boolean
  ids: string[]
  reason: string
}

interface PullRequestEvent {
  action?: string
  pull_request?: { body?: string | null }
  changes?: { body?: { from?: string | null } }
}

export function planFor(event: PullRequestEvent): Plan {
  const block = parseBlock(event.pull_request?.body)
  if (block === null) return { capture: false, ids: [], reason: 'No screens block in the pull request body.' }
  // An edit that did not touch the body (the title, the base) carries no `changes.body`.
  if (event.action === 'edited') {
    const before = event.changes?.body
    if (before === undefined || sameBlock(parseBlock(before.from), block)) {
      return { capture: false, ids: block.ids, reason: 'The edit left the screens block as it was.' }
    }
  }
  if (block.ids.length === 0) return { capture: false, ids: [], reason: 'The screens block is empty.' }
  return { capture: true, ids: block.ids, reason: `Capturing: ${block.ids.join(' ')}` }
}

/**
 * Run directly: `node e2e/screens/block.ts [ids-file]`. Reads the event from $GITHUB_EVENT_PATH
 * (never from an expression in the workflow: the body is untrusted text), writes `capture` to
 * $GITHUB_OUTPUT, and the ids, one per line, to the file given.
 */
function main(): void {
  const eventPath = process.env['GITHUB_EVENT_PATH']
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set')
  const plan = planFor(JSON.parse(readFileSync(eventPath, 'utf8')) as PullRequestEvent)
  const output = process.env['GITHUB_OUTPUT']
  if (output) appendFileSync(output, `capture=${plan.capture}\n`)
  const idsFile = process.argv[2]
  if (idsFile) writeFileSync(idsFile, plan.ids.map((id) => `${id}\n`).join(''))
  console.log(plan.reason)
}

if (/[\\/]block\.ts$/.test(process.argv[1] ?? '')) main()
