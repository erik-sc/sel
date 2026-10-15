import { describe, expect, it } from 'vitest'
import { NOTEBOOK_BELL_KEY } from '../../shared/notebook'
import { isWritableSetting, settingValueFor, writableSettingKey } from '../validate'

describe('the bell setting, from a window', () => {
  it('may be written, as a boolean only', () => {
    expect(isWritableSetting(NOTEBOOK_BELL_KEY)).toBe(true)
    expect(writableSettingKey(NOTEBOOK_BELL_KEY)).toBe(NOTEBOOK_BELL_KEY)
    expect(settingValueFor(NOTEBOOK_BELL_KEY, false)).toBe(false)
    expect(settingValueFor(NOTEBOOK_BELL_KEY, null)).toBeNull()
    expect(() => settingValueFor(NOTEBOOK_BELL_KEY, 'loud')).toThrow(/Invalid setting value/)
  })

  it('is the only notebook key a window may write', () => {
    expect(isWritableSetting('notebook.anything')).toBe(false)
    expect(() => writableSettingKey('notebook.anything')).toThrow(/read-only/)
  })
})
