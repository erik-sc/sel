// What the AI service counts for Settings → AI (C5): every request that reached the program, by
// origin, with its time and the cost the program reported. Run against the stand-in program.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { CliLocation } from './locate'
import { readEvent } from './ndjson'
import { AiService, type AiUsageReport, type RunTarget } from './service'

const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'sel-usage-'))
afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 }))

function service(settings: Record<string, unknown> = {}) {
  const reports: AiUsageReport[] = []
  const fake: CliLocation = { path: FAKE, kind: 'node-script' }
  const created = new AiService({
    sandboxDir: join(root, 'sandbox'),
    getSetting: (key) => settings[key] ?? null,
    loadContext: () => ({}),
    locate: () => ({ ok: true, cli: fake }),
    onUsage: (report) => reports.push(report)
  })
  return { created, reports }
}

const prompt = (target: AiService, text: string, options?: RunTarget): Promise<string> =>
  new Promise((resolve, reject) => {
    target.runPrompt(() => text, { delta: () => undefined, done: (result) => resolve(result.text), error: reject }, null, options)
  })

describe('counting what the AI was used for', () => {
  it('reads the cost from the result event, when there is one', () => {
    expect(readEvent({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.25 })).toEqual({
      kind: 'result',
      text: 'ok',
      isError: false,
      subtype: 'success',
      costUsd: 0.25
    })
    expect(readEvent({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: -1 })).not.toHaveProperty(
      'costUsd'
    )
  })

  it('counts a request under its origin, with its time and cost', async () => {
    const { created, reports } = service()
    await prompt(created, 'Task: Check in on the user’s day.\none of the routines the user turned on [[fake:instant]]', {
      origin: 'routine:midday'
    })
    await prompt(created, 'Task: Say hello. [[fake:instant]]')
    expect(reports).toHaveLength(2)
    expect(reports[0]).toMatchObject({ origin: 'routine:midday', costUsd: 0.0123, ok: true })
    expect(reports[0].durationMs).toBeGreaterThanOrEqual(0)
    // Without an origin a request is the user's.
    expect(reports[1]).toMatchObject({ origin: 'you', costUsd: 0, ok: true })
    created.dispose()
  })

  it('counts a request that failed in the program, and not one that never reached it', async () => {
    const { created, reports } = service()
    await expect(prompt(created, 'Task: x [[fake:error-rate]]', { origin: 'memory' })).rejects.toBeTruthy()
    expect(reports).toEqual([expect.objectContaining({ origin: 'memory', ok: false, costUsd: null })])
    const off = service({ 'ai.enabled': false })
    await expect(prompt(off.created, 'Task: x', { origin: 'memory' })).rejects.toBeTruthy()
    expect(off.reports).toEqual([])
    created.dispose()
    off.created.dispose()
  })
})
