import { describe, expect, it } from 'vitest'
import { HIDE_SLACK_PX, REVEAL_EDGE_PX, escapeLeavesFocus, revealAfterMove, type EscapeFacts } from './focusMode'

describe('revealAfterMove', () => {
  const bottom = 86

  it('brings the bars back only at the top edge', () => {
    expect(revealAfterMove(false, 0, bottom)).toBe(true)
    expect(revealAfterMove(false, REVEAL_EDGE_PX, bottom)).toBe(true)
    expect(revealAfterMove(false, REVEAL_EDGE_PX + 1, bottom)).toBe(false)
    expect(revealAfterMove(false, 40, bottom)).toBe(false)
  })

  it('keeps them while the pointer is on them or just below', () => {
    expect(revealAfterMove(true, 40, bottom)).toBe(true)
    expect(revealAfterMove(true, bottom, bottom)).toBe(true)
    expect(revealAfterMove(true, bottom + HIDE_SLACK_PX, bottom)).toBe(true)
  })

  it('hides them once the pointer is well below', () => {
    expect(revealAfterMove(true, bottom + HIDE_SLACK_PX + 1, bottom)).toBe(false)
    expect(revealAfterMove(true, 600, bottom)).toBe(false)
  })
})

describe('escapeLeavesFocus', () => {
  const escape: EscapeFacts = {
    key: 'Escape',
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false
  }

  it('leaves on a plain Escape nothing else took', () => {
    expect(escapeLeavesFocus(escape, true)).toBe(true)
  })

  it('does nothing outside focus mode', () => {
    expect(escapeLeavesFocus(escape, false)).toBe(false)
  })

  it('leaves the key to whatever used it first', () => {
    expect(escapeLeavesFocus({ ...escape, defaultPrevented: true }, true)).toBe(false)
    expect(escapeLeavesFocus({ ...escape, isComposing: true }, true)).toBe(false)
    expect(escapeLeavesFocus({ ...escape, repeat: true }, true)).toBe(false)
  })

  it('ignores other keys and Escape with modifiers', () => {
    expect(escapeLeavesFocus({ ...escape, key: 'Enter' }, true)).toBe(false)
    expect(escapeLeavesFocus({ ...escape, shiftKey: true }, true)).toBe(false)
    expect(escapeLeavesFocus({ ...escape, ctrlKey: true }, true)).toBe(false)
  })
})
