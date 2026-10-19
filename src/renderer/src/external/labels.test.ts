import { describe, expect, it } from 'vitest'
import type { McpStatus } from '../../../shared/mcp'
import { callTime, stateLine, TOOL_LABELS } from './labels'

const status = (patch: Partial<McpStatus>): McpStatus => ({
  enabled: true,
  running: true,
  error: null,
  persistent: true,
  claudeCode: '',
  claudeDesktop: '',
  calls: [],
  ...patch
})

describe('Settings → MCP', () => {
  it('says whether apps can connect now', () => {
    expect(stateLine(null)).toEqual({ text: '', error: false })
    expect(stateLine(status({ enabled: false, running: false }))).toEqual({ text: 'Off: no app can connect.', error: false })
    expect(stateLine(status({ running: false }))).toEqual({ text: 'Opening…', error: false })
    expect(stateLine(status({ running: false, error: 'The connection for other apps could not be opened.' })).error).toBe(true)
    expect(stateLine(status({})).text).toMatch(/^On:/)
  })

  it('names every tool an app can call', () => {
    // The tools of src/main/ai/toolspecs.ts, which the renderer does not import.
    for (const name of [
      'search',
      'outline',
      'read_page',
      'read_database',
      'recent',
      'audit',
      'create_page',
      'append_to_page',
      'add_database_row',
      'update_database_row'
    ]) {
      expect(TOOL_LABELS[name]).toBeTruthy()
    }
  })

  it('gives the time of a call today, and the day before that', () => {
    const now = new Date(2026, 9, 15, 15, 0)
    expect(callTime(new Date(2026, 9, 15, 9, 5, 7).getTime(), now, 'en-GB')).toBe('09:05:07')
    expect(callTime(new Date(2026, 9, 14, 9, 5, 7).getTime(), now, 'en-GB')).toBe('14 Oct 09:05:07')
  })
})
