import { describe, expect, it, vi } from 'vitest'
import { COMMANDS } from '@shared/commands'

// The features' gates read the platform and listen for changes as they load.
vi.stubGlobal('window', { api: { clientId: 'w', onChange: () => () => {}, app: { platform: 'win32' } } })
const { FEATURES } = await import('./features')

describe('the features of a window', () => {
  it('have their own ids', () => {
    const ids = FEATURES.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('handle every command once', () => {
    const handled = FEATURES.flatMap((feature) => Object.keys(feature.menu ?? {}))
    expect([...handled].sort()).toEqual(COMMANDS.map((command) => command.id).sort())
  })

  it('give each overlay its own place in its slot', () => {
    for (const slot of ['content', 'window'] as const) {
      const orders = FEATURES.flatMap((feature) => (feature.overlays ?? []).filter((o) => o.slot === slot).map((o) => o.order))
      expect(new Set(orders).size, slot).toBe(orders.length)
    }
  })
})
