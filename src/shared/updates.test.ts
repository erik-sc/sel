import { describe, expect, it } from 'vitest'
import { cleanUpdatesSetting, cleanVersion, emptyUpdateStatus, releaseNotesUrl } from './updates'

describe('versions from the feed', () => {
  it('are plain version numbers', () => {
    for (const version of ['0.3.0', '1.0.0', '10.20.30', '1.0.0-beta.1']) expect(cleanVersion(version)).toBe(version)
    for (const version of ['', 'v0.3.0', '0.3', '0.3.0 ', '0.3.0/../x', '<b>1.0.0</b>', 3, null]) expect(cleanVersion(version)).toBeNull()
  })

  it('name their release page on GitHub', () => {
    expect(releaseNotesUrl('0.3.0')).toBe('https://github.com/erik-sc/sel/releases/tag/v0.3.0')
    expect(releaseNotesUrl('0.3.0?x=1')).toBeNull()
  })
})

describe('the updates setting', () => {
  it('takes a boolean for updates.check and nothing else', () => {
    expect(cleanUpdatesSetting('updates.check', true)).toBe(true)
    expect(cleanUpdatesSetting('updates.check', false)).toBe(false)
    expect(cleanUpdatesSetting('updates.check', 'on')).toBeUndefined()
    expect(cleanUpdatesSetting('updates.lastCheck', 5)).toBeUndefined()
  })
})

describe('emptyUpdateStatus', () => {
  it('starts with nothing known', () => {
    expect(emptyUpdateStatus('0.2.0', true)).toMatchObject({ current: '0.2.0', supported: true, phase: 'idle', version: null, dismissed: false })
  })
})
