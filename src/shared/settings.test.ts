import { describe, expect, it } from 'vitest'
import { cleanSettingValue, SETTINGS, type SettingsSpec, settingsSpecOf, syncedAtOf } from './settings'

describe('the settings specs', () => {
  it('give each exact key and each namespace to one spec', () => {
    const keys = SETTINGS.flatMap((spec) => spec.keys ?? [])
    expect(new Set(keys).size).toBe(keys.length)
    const namespaces = SETTINGS.flatMap((spec) => spec.namespaces ?? [])
    expect(new Set(namespaces).size).toBe(namespaces.length)
  })

  it('stamp only keys they name exactly, with a sync.* setting no renderer may write', () => {
    for (const spec of SETTINGS) {
      for (const [key, at] of Object.entries(spec.syncedAt ?? {})) {
        expect(spec.keys, key).toContain(key)
        expect(at).toMatch(/^sync\.[A-Za-z]+At$/)
        expect(settingsSpecOf(at)).toBeNull()
      }
    }
    expect(syncedAtOf('appearance')).toBe('sync.appearanceAt')
    expect(syncedAtOf('appearance.tokens')).toBeNull()
    expect(syncedAtOf('briefing.name')).toBeNull()
  })

  it('lets an exact key win over a namespace', () => {
    expect(settingsSpecOf('shell.startup')?.exact).toBe(true)
    expect(settingsSpecOf('shell.tabs')?.exact).toBe(false)
    expect(settingsSpecOf('nope.x')).toBeNull()
    expect(settingsSpecOf('nope')).toBeNull()
  })

  it('cleans with one rule for every feature: null resets, a refused value or a dialog-only key throws', () => {
    const spec: SettingsSpec = {
      keys: ['fake.n', 'fake.path'],
      clean: (_key, value) => (typeof value === 'number' ? Math.round(value) : undefined),
      dialogOnly: { keys: ['fake.path'], message: 'Only the dialog' }
    }
    expect(cleanSettingValue(spec, 'fake.n', 1.4)).toBe(1)
    expect(cleanSettingValue(spec, 'fake.n', null)).toBeNull()
    expect(cleanSettingValue(spec, 'fake.n', undefined)).toBeNull()
    expect(() => cleanSettingValue(spec, 'fake.n', 'x')).toThrow('Invalid setting value')
    expect(cleanSettingValue(spec, 'fake.path', null)).toBeNull()
    expect(() => cleanSettingValue(spec, 'fake.path', 'C:\\x.exe')).toThrow('Only the dialog')
  })
})
