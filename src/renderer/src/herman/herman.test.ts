/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { moodAfter, noteAiEvent, setHermanMood, useHerman, type HermanMood } from './gate'
import { cornerAfterKey, EDIT_PAUSE_MS, editingSince, fromClock, near, nearestCorner, poseFor, toClock } from './mood'
import { PATHS, POSES, THOUGHT_PATH, toPath, VIEW_BOX, Z_PATH, type Pose } from './poses'

// ------------------------------------------------------------------ the figure

/** A path as its commands and its numbers. */
function parse(d: string): { commands: string; numbers: number[] } {
  return { commands: d.replace(/[^A-Za-z]/g, ''), numbers: (d.match(/-?\d*\.?\d+/g) ?? []).map(Number) }
}

describe('the figure', () => {
  const resting = parse(PATHS.resting)

  it('is one continuous line: a single stroke of curves, never lifted', () => {
    for (const pose of POSES) {
      const { commands } = parse(PATHS[pose])
      expect(commands, pose).toMatch(/^MC+$/)
      expect(PATHS[pose].indexOf('M', 1), pose).toBe(-1)
      expect(PATHS[pose], pose).not.toMatch(/[zZ]/)
    }
    expect(resting.commands.length).toBe(48)
  })

  it('has every pose in the same structure, so that one can flow into the next', () => {
    for (const pose of POSES) {
      const shape = parse(PATHS[pose])
      expect(shape.commands, pose).toBe(resting.commands)
      expect(shape.numbers.length, pose).toBe(resting.numbers.length)
    }
    expect(resting.numbers.length).toBe(2 + 47 * 6)
  })

  it('stays inside its frame, with room for the width of the line', () => {
    const [, , width, height] = VIEW_BOX.split(' ').map(Number)
    expect([width, height]).toEqual([116, 116])
    for (const pose of POSES) {
      const { numbers } = parse(PATHS[pose])
      for (let index = 0; index < numbers.length; index += 2) {
        expect(numbers[index], `${pose} x`).toBeGreaterThanOrEqual(3)
        expect(numbers[index], `${pose} x`).toBeLessThanOrEqual(width - 3)
        expect(numbers[index + 1], `${pose} y`).toBeGreaterThanOrEqual(3)
        expect(numbers[index + 1], `${pose} y`).toBeLessThanOrEqual(height - 3)
      }
    }
  })

  it('stands on the same ground in every pose: the staff keeps its foot', () => {
    const foot = resting.numbers.slice(-2)
    for (const pose of POSES) expect(parse(PATHS[pose]).numbers.slice(-2), pose).toEqual(foot)
  })

  it('gives each pose a shape of its own', () => {
    const seen = new Map<string, Pose>()
    for (const pose of POSES) {
      expect(seen.get(PATHS[pose]), `${pose} is drawn like another pose`).toBeUndefined()
      seen.set(PATHS[pose], pose)
    }
    /** How far the points of a pose are from where they rest, in total. */
    const moved = (pose: Pose): number => parse(PATHS[pose]).numbers.reduce((sum, value, index) => sum + Math.abs(value - resting.numbers[index]), 0)
    // A blink touches the eyes only; a bow or sleep moves the whole of him.
    expect(moved('blink')).toBeGreaterThan(5)
    expect(moved('blink')).toBeLessThan(moved('listening'))
    expect(moved('listening')).toBeLessThan(moved('pleased'))
    expect(moved('pleased')).toBeLessThan(moved('sleeping'))
    expect(moved('concerned')).toBeGreaterThan(moved('blink'))
    // The two mouth shapes are close to each other: a murmur, not a wave.
    const a = parse(PATHS.speaking).numbers
    const b = parse(PATHS.speaking2).numbers
    const between = a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0)
    expect(between).toBeGreaterThan(10)
    expect(between).toBeLessThan(moved('pleased'))
  })

  it('closes his eyes to blink and to sleep: the lenses flatten', () => {
    // The near lens is the four anchors after the far one; its height is what closes.
    const lensHeight = (pose: Pose): number => {
      const { numbers } = parse(PATHS[pose])
      // Anchors are the end points of the segments: the start, then every third pair.
      const anchors = [numbers.slice(0, 2), ...Array.from({ length: 47 }, (_, index) => numbers.slice(2 + index * 6 + 4, 2 + index * 6 + 6))]
      const ys = anchors.slice(19, 23).map(([, y]) => y)
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(lensHeight('resting')).toBeCloseTo(12, 0)
    expect(lensHeight('blink')).toBeLessThan(3)
    expect(lensHeight('sleeping')).toBeLessThan(4)
    expect(lensHeight('pleased')).toBeLessThan(lensHeight('resting'))
    expect(lensHeight('concerned')).toBeGreaterThan(lensHeight('resting'))
  })

  it('turns anchors into curves that pass through them, round or cornered as asked', () => {
    expect(toPath([[0, 0], [10, 0], [20, 0]])).toBe('M0 0C1.7 0 6.7 0 10 0C13.3 0 18.3 0 20 0')
    // A corner (roundness 0) has no handles: the line arrives and leaves straight.
    expect(toPath([[0, 0], [10, 10, 0], [20, 0]])).toBe('M0 0C1.7 1.7 10 10 10 10C10 10 18.3 1.7 20 0')
    expect(toPath([[1.26, 2.34], [3, 4]])).toBe('M1.3 2.3C1.6 2.6 2.7 3.7 3 4')
  })

  it('has its two small marks: a z for sleep, a curl for thought', () => {
    expect(Z_PATH).toMatch(/^M[\d. ]+h/)
    expect(THOUGHT_PATH.startsWith('M')).toBe(true)
  })
})

// ------------------------------------------------------------------ poses from state

describe('which pose he takes', () => {
  it('follows a request first: thinking, speaking, then pleased or concerned', () => {
    for (const mood of ['thinking', 'speaking', 'pleased', 'concerned'] as HermanMood[]) {
      expect(poseFor({ mood })).toBe(mood)
      expect(poseFor({ mood, attended: true, saying: true, asleep: true })).toBe(mood)
    }
  })

  it('speaks his own line, listens when attended to, sleeps only when nothing else is going on', () => {
    expect(poseFor({ mood: 'idle' })).toBe('resting')
    expect(poseFor({ mood: 'idle', asleep: true })).toBe('sleeping')
    expect(poseFor({ mood: 'idle', attended: true })).toBe('listening')
    expect(poseFor({ mood: 'idle', attended: true, asleep: true })).toBe('listening')
    expect(poseFor({ mood: 'idle', saying: true, attended: true, asleep: true })).toBe('speaking')
  })

  it('maps the life of a request to moods: waiting, streaming, done, failed, stopped', () => {
    expect(moodAfter('start')).toBe('thinking')
    expect(moodAfter('started')).toBeNull()
    expect(moodAfter('delta')).toBe('speaking')
    expect(moodAfter('done')).toBe('pleased')
    expect(moodAfter('error')).toBe('concerned')
    expect(moodAfter('rejected')).toBe('concerned')
    // Stopping a request is the user's doing: nothing to be concerned about.
    expect(moodAfter('error', true)).toBe('idle')
    expect(moodAfter('cancel')).toBe('idle')
    expect(moodAfter('reset')).toBe('idle')
  })
})

describe('his mood over time', () => {
  afterEach(() => {
    vi.useRealTimers()
    useHerman.setState({ on: false, mood: 'idle' })
  })

  it('goes through a streamed answer and settles by itself afterwards', () => {
    vi.useFakeTimers()
    useHerman.setState({ on: true, mood: 'idle' })
    const seen: HermanMood[] = []
    const off = useHerman.subscribe((state) => seen.push(state.mood))
    for (const event of ['start', 'started', 'delta', 'delta', 'done'] as const) noteAiEvent(event)
    expect(seen).toEqual(['thinking', 'speaking', 'pleased'])
    vi.advanceTimersByTime(2500)
    expect(useHerman.getState().mood).toBe('pleased')
    vi.advanceTimersByTime(200)
    expect(useHerman.getState().mood).toBe('idle')
    // Concern lasts a little longer, and a new request ends it at once.
    noteAiEvent('start')
    noteAiEvent('error')
    vi.advanceTimersByTime(5000)
    expect(useHerman.getState().mood).toBe('concerned')
    noteAiEvent('start')
    vi.advanceTimersByTime(60_000)
    expect(useHerman.getState().mood).toBe('thinking')
    off()
  })

  it('does not move at all while he is off', () => {
    vi.useFakeTimers()
    useHerman.setState({ on: false, mood: 'idle' })
    for (const event of ['start', 'delta', 'done', 'error'] as const) noteAiEvent(event)
    expect(useHerman.getState().mood).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no timer behind once he has settled', () => {
    vi.useFakeTimers()
    useHerman.setState({ on: true, mood: 'idle' })
    setHermanMood('pleased')
    expect(vi.getTimerCount()).toBe(1)
    vi.runAllTimers()
    expect(vi.getTimerCount()).toBe(0)
    setHermanMood('thinking')
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ------------------------------------------------------------------ his corner

describe('keeping out of the way', () => {
  const dock = { left: 1100, top: 700, right: 1160, bottom: 760 }

  it('knows when the caret or a menu is near him', () => {
    expect(near(dock, { left: 1090, top: 720, right: 1091, bottom: 740 }, 28)).toBe(true)
    expect(near(dock, { left: 1000, top: 720, right: 1001, bottom: 740 }, 28)).toBe(false)
    expect(near(dock, { left: 1120, top: 660, right: 1121, bottom: 680 }, 28)).toBe(true)
    expect(near(dock, { left: 1120, top: 600, right: 1121, bottom: 620 }, 28)).toBe(false)
    // Something that overlaps him is near whatever the margin.
    expect(near(dock, { left: 900, top: 650, right: 1300, bottom: 900 }, 0)).toBe(true)
    // Touching exactly at the margin is not yet near.
    expect(near(dock, { left: 0, top: 700, right: 1072, bottom: 760 }, 28)).toBe(false)
    expect(near(dock, { left: 0, top: 700, right: 1073, bottom: 760 }, 28)).toBe(true)
  })

  it('snaps to the corner he is dropped closest to', () => {
    const area = { left: 280, top: 90, right: 1190, bottom: 790 }
    expect(nearestCorner(area, 300, 100)).toBe('top-left')
    expect(nearestCorner(area, 1100, 100)).toBe('top-right')
    expect(nearestCorner(area, 300, 700)).toBe('bottom-left')
    expect(nearestCorner(area, 1100, 700)).toBe('bottom-right')
    expect(nearestCorner(area, 735, 440)).toBe('bottom-right')
    expect(nearestCorner(area, -50, -50)).toBe('top-left')
  })

  it('moves by the arrow keys, one side at a time', () => {
    expect(cornerAfterKey('bottom-right', 'ArrowLeft')).toBe('bottom-left')
    expect(cornerAfterKey('bottom-left', 'ArrowUp')).toBe('top-left')
    expect(cornerAfterKey('top-left', 'ArrowRight')).toBe('top-right')
    expect(cornerAfterKey('top-right', 'ArrowDown')).toBe('bottom-right')
    expect(cornerAfterKey('top-right', 'ArrowUp')).toBe('top-right')
    expect(cornerAfterKey('top-right', 'Enter')).toBe('top-right')
  })
})

describe('how long a page has been edited', () => {
  it('counts one stretch until a pause of five minutes starts another', () => {
    let editing = editingSince(null, 1000)
    expect(editing).toEqual({ since: 1000, last: 1000 })
    editing = editingSince(editing, 1000 + 60_000)
    editing = editingSince(editing, 1000 + EDIT_PAUSE_MS)
    expect(editing).toEqual({ since: 1000, last: 1000 + EDIT_PAUSE_MS })
    const resumed = editing.last + EDIT_PAUSE_MS + 1
    expect(editingSince(editing, resumed)).toEqual({ since: resumed, last: resumed })
    // A clock that went backwards starts over rather than counting a negative stretch.
    expect(editingSince(editing, 5)).toEqual({ since: 5, last: 5 })
  })
})

describe('quiet hours as the settings show them', () => {
  it('turns minutes of the day into a time field and back', () => {
    expect([0, 480, 1260, 1439].map(toClock)).toEqual(['00:00', '08:00', '21:00', '23:59'])
    expect(['00:00', '08:00', '21:00', '23:59'].map(fromClock)).toEqual([0, 480, 1260, 1439])
    expect(['', '8:00', '24:00', '12:60', '12:5', 'noon', '12:00:00'].map(fromClock)).toEqual([null, null, null, null, null, null, null])
  })
})

// ------------------------------------------------------------------ the stylesheet

describe('herman.css', () => {
  const css = readFileSync(fileURLToPath(new URL('./herman.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = [...css.matchAll(/(?<=[;{])\s*([a-z-]+)\s*:\s*([^;{}]+);/g)].map((match) => ({ property: match[1], value: match[2].trim().replace(/\s+/g, ' ') }))

  it('is read as declarations', () => {
    // Every `property: value;` of the file, and nothing that is not one.
    expect(declarations.length).toBe(css.split(';').length - 1)
    expect(declarations.length).toBeGreaterThan(150)
  })

  it('takes every colour, type size and weight, radius and shadow from the tokens', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\b(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/)
    const tokenOnly = /^var\(--[a-z0-9-]+\)$/
    for (const { property, value } of declarations) {
      const where = `${property}: ${value}`
      if (['font-size', 'font-weight', 'font-family', 'border-radius', 'box-shadow'].includes(property)) expect(value, where).toMatch(tokenOnly)
      if (['color', 'background', 'background-color', 'stroke', 'fill'].includes(property)) expect(value, where).toMatch(/^(var\(--[a-z0-9-]+\)|currentColor|none|transparent)$/)
      if (property === 'outline') expect(value, where).toMatch(/^\d+px solid var\(--focus-ring\)$/)
      expect(property, where).not.toMatch(/^(text-shadow|filter|backdrop-filter|border(-(top|right|bottom|left))?(-color)?)$/)
    }
  })

  it('times every movement in multiples of the duration tokens', () => {
    // No raw time anywhere: only `0s`, which is no time at all.
    const raw = css.match(/(?<![\w.-])\d*\.?\d+m?s\b/g) ?? []
    expect(raw.filter((value) => value !== '0s')).toEqual([])
    for (const { property, value } of declarations) {
      if (!/^(transition|animation)(-duration|-delay)?$/.test(property) || value === 'none') continue
      expect(value, `${property}: ${value}`).toMatch(/var\(--duration(-fast)?\)/)
    }
    const eases = declarations.filter(({ property }) => property === 'transition' || property === 'animation').flatMap(({ value }) => value.match(/var\(--ease\)|ease-in-out|linear|ease(?![-\w])/g) ?? [])
    // --ease everywhere, with two stated exceptions: the stroke that draws him, and the turning curl (his, and his council's).
    expect(eases.filter((ease) => ease !== 'var(--ease)').sort()).toEqual(['ease-in-out', 'linear', 'linear'])
    expect(css).toMatch(/\.council-face\.is-thinking \.council-face-thought \{[^}]*linear infinite/)
  })

  it('stills everything when motion is to be reduced', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? ''
    expect(reduced).toMatch(/\.herman-figure,[\s\S]*?\{\s*transition: none;/)
    expect(reduced).toMatch(/\.herman-figure\.is-breathing \{\s*transform: none;/)
    expect(reduced).toMatch(/\.herman-figure\.is-drawn \.herman-line,[\s\S]*?animation: none;/)
    expect(reduced).toMatch(/\.herman-figure\.is-thinking \.herman-thought \{[\s\S]*?animation: none;/)
    expect(reduced).toMatch(/\.herman-dock\.is-aside \{\s*transform: none;/)
  })

  it('animates nothing forever except the small curl while he (or a member of his council) thinks', () => {
    const forever = declarations.filter(({ property, value }) => property === 'animation' && value.includes('infinite'))
    expect(forever.length).toBe(2)
    expect(css).toMatch(/\.herman-figure\.is-thinking \.herman-thought \{[^}]*infinite/)
    expect(css).toMatch(/\.council-face\.is-thinking \.council-face-thought \{[^}]*infinite/)
  })
})
