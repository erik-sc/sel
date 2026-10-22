import { describe, expect, it } from 'vitest'
import { SETTINGS_SECTIONS } from './settingsSections'

describe('the sections of Settings', () => {
  it('are listed in this order, each with its own place', () => {
    expect(SETTINGS_SECTIONS.map((section) => [section.id, section.label])).toEqual([
      ['general', 'General'],
      ['sidebar', 'Sidebar'],
      ['history', 'History'],
      ['ai', 'AI'],
      ['herman', 'Herman'],
      ['notifications', 'Notifications'],
      ['sync', 'Sync'],
      ['today', 'Today'],
      ['meetings', 'Meetings'],
      ['pomodoro', 'Pomodoro'],
      ['mcp', 'MCP']
    ])
    const orders = SETTINGS_SECTIONS.map((section) => section.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('fetch with the window the panels that used to be part of it', () => {
    expect(SETTINGS_SECTIONS.filter((section) => section.withDialog).map((section) => section.id)).toEqual([
      'general',
      'history',
      'ai',
      'today'
    ])
  })
})
