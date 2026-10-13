// Herman's figure: one continuous line, drawn the way a calligrapher would draw an old man in a
// single stroke. The line starts as the curl of an ear, falls down the back of a long beard and
// comes up its front to the moustache and the nose, writes the two loops of his spectacles,
// lifts into a heavy brow, goes over the bald head and down the stooped back, runs along the
// hem, reaches out as a sleeve to the staff he leans on, climbs it, circles its knob and comes
// back down it to the ground.
//
// The line is authored as a list of anchors it passes through; a spline turns them into cubic
// curves. Every pose moves the same anchors, so every pose has the same path structure and one
// pose can flow into another (CSS interpolates `d` between paths of equal structure).
// Pure: no DOM, unit tested.

export const POSES = ['resting', 'listening', 'thinking', 'speaking', 'speaking2', 'pleased', 'sleeping', 'concerned', 'blink'] as const
export type Pose = (typeof POSES)[number]

/** The drawing's coordinate space; the figure keeps a margin inside it for the width of the line. */
export const VIEW_BOX = '0 0 116 116'

type Point = readonly [x: number, y: number]
/** x, y and how round the line is as it passes through (1: flowing, 0: a corner). */
type Anchor = readonly [x: number, y: number, round?: number]

// Anchor indices, by part.
const EAR = [0, 1, 2, 3] as const
const BEARD_BACK = [4, 5, 6] as const
const TIP = 7
const BEARD_FRONT = [8, 9] as const
const MOUSTACHE = 10
const UNDER_NOSE = 11
const NOSE = 12
const BRIDGE = 13
const FAR_LENS = [14, 15, 16, 17, 18] as const
const NEAR_LENS = [19, 20, 21, 22] as const
const BROW = 23
const DOME = [24, 25, 26, 27] as const
const NAPE = 28
const SHOULDER = 29
const HUMP = 30
const BACK = [31, 32] as const
const HEM = [33, 34, 35] as const
const ARM = [36, 37, 38] as const
const HAND = 39
const KNOB = [40, 41, 42, 43, 44, 45] as const
const STAFF = [46, 47] as const

/** A loop of four anchors is a circle when the line is this round through them. */
const R = 1.66

const BASE: readonly Anchor[] = [
  // the ear, a small curl the line starts from
  [63.5, 36.5],
  [66, 33.5],
  [62.5, 31],
  [59.5, 35.5],
  // down the back edge of the beard
  [59, 48],
  [57.5, 64],
  [51, 79.5],
  // its tip, swept forward
  [39.5, 90, 0.75],
  // up its front edge
  [39.6, 78],
  [38.6, 64],
  // moustache, nose
  [33, 54],
  [37.5, 48],
  [30.5, 45],
  [37.5, 39],
  // the far lens of the spectacles
  [38.3, 32.8, R],
  [34, 28, R],
  [29.7, 32.3, R],
  [34, 36.6, R],
  [38.5, 32.3],
  // the near lens
  [47, 26, R],
  [53, 32, R],
  [47, 38, R],
  [41, 32.5, R],
  // brow, head
  [34.8, 25.6],
  [41.5, 16.5],
  [55, 7.5],
  [68, 14],
  [71.5, 28],
  [69, 38],
  // the stooped back
  [76, 44],
  [89.5, 54],
  [95, 73],
  [94.5, 94],
  // the hem
  [87, 107, 0.9],
  [71, 109],
  [58, 108],
  // the sleeve, reaching for the staff
  [46, 102.5],
  [32.5, 97],
  [22.5, 86.5],
  [17.6, 73, 0.8],
  // up the staff to its knob, around it, and back down the staff to the ground
  [17.3, 58, 0.5],
  [17.2, 47.4, 0.8],
  [20.2, 44, R],
  [17.2, 40.8, R],
  [14.2, 44, R],
  [16.4, 47.4, 0.8],
  [16, 74, 0.4],
  [14.5, 109, 0]
]

/** Where the head turns, where the body bends, and where the staff stands. */
const NECK: Point = [70, 42]
const HIP: Point = [86, 104]
const FOOT: Point = [14.5, 109]
const GROUND = 109

type Rig = Anchor[]

function rotate(rig: Rig, indices: readonly number[], pivot: Point, degrees: number, weight = 1): void {
  const angle = (degrees * weight * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (const index of indices) {
    const [x, y, round] = rig[index]
    const dx = x - pivot[0]
    const dy = y - pivot[1]
    rig[index] = [pivot[0] + dx * cos - dy * sin, pivot[1] + dx * sin + dy * cos, round]
  }
}

function shift(rig: Rig, indices: readonly number[], dx: number, dy: number): void {
  for (const index of indices) {
    const [x, y, round] = rig[index]
    rig[index] = [x + dx, y + dy, round]
  }
}

/** Scales a part about its own middle: lenses that close, an ear that flattens. */
function squash(rig: Rig, indices: readonly number[], factor: number, factorX = 1): void {
  let cx = 0
  let cy = 0
  for (const index of indices) {
    cx += rig[index][0]
    cy += rig[index][1]
  }
  cx /= indices.length
  cy /= indices.length
  for (const index of indices) {
    const [x, y, round] = rig[index]
    rig[index] = [cx + (x - cx) * factorX, cy + (y - cy) * factor, round]
  }
}

const FACE = [UNDER_NOSE, NOSE, BRIDGE, ...FAR_LENS, ...NEAR_LENS, BROW] as const
const HEAD = [...EAR, ...FACE, ...DOME] as const
const UPPER = [...HEAD, ...BEARD_BACK, TIP, ...BEARD_FRONT, MOUSTACHE, NAPE, SHOULDER, HUMP] as const

/** Turns the head about the neck; the beard follows less and less toward its tip. */
function tilt(rig: Rig, degrees: number): void {
  rotate(rig, HEAD, NECK, degrees)
  rotate(rig, [MOUSTACHE, BEARD_BACK[0]], NECK, degrees, 0.9)
  rotate(rig, [BEARD_FRONT[1], BEARD_BACK[1], NAPE], NECK, degrees, 0.6)
  rotate(rig, [BEARD_FRONT[0], BEARD_BACK[2]], NECK, degrees, 0.35)
  rotate(rig, [TIP], NECK, degrees, 0.2)
}

/** Bends the upper body about the hip; the hand goes with it, so the staff leans on its foot. */
function lean(rig: Rig, degrees: number): void {
  rotate(rig, UPPER, HIP, degrees)
  rotate(rig, [BACK[0]], HIP, degrees, 0.5)
  rotate(rig, [ARM[1]], FOOT, degrees, 0.3)
  rotate(rig, [ARM[2], HAND, ...KNOB, STAFF[0]], FOOT, degrees, 0.6)
}

function eyes(rig: Rig, factor: number): void {
  squash(rig, FAR_LENS, factor)
  squash(rig, NEAR_LENS, factor)
}

const BUILD: Record<Pose, (rig: Rig) => void> = {
  resting: () => undefined,
  // The head inclines toward whoever is speaking, and the beard swings that way.
  listening(rig) {
    lean(rig, -3)
    tilt(rig, -9)
    shift(rig, [TIP], -2, 0.5)
  },
  // The head goes back a little, as if reading something written on the ceiling.
  thinking(rig) {
    tilt(rig, 7)
    shift(rig, [BROW], -0.5, -1.5)
    shift(rig, [TIP], 1.5, -1)
  },
  // Two mouth shapes: the moustache lifts and falls, and the beard sways with it.
  speaking(rig) {
    tilt(rig, -2)
    shift(rig, [MOUSTACHE], -1.2, 1.8)
    shift(rig, [UNDER_NOSE], 0.6, 1)
    shift(rig, [BEARD_FRONT[1]], -1, 1)
    shift(rig, [TIP], -1, 0.6)
  },
  speaking2(rig) {
    tilt(rig, 1)
    shift(rig, [MOUSTACHE], 1, -1.2)
    shift(rig, [BEARD_FRONT[1]], 0.8, -0.5)
    shift(rig, [TIP], 1, -0.4)
  },
  // A small bow, eyes narrowed by a smile.
  pleased(rig) {
    lean(rig, -7)
    tilt(rig, -10)
    eyes(rig, 0.55)
    shift(rig, [BROW], 0.5, 1)
    shift(rig, [MOUSTACHE], -0.8, -1.2)
  },
  // The line settles: the head sinks to the chest, the eyes close, the back rounds.
  sleeping(rig) {
    for (const index of [...UPPER, ...BACK]) {
      const [x, y, round] = rig[index]
      rig[index] = [x, GROUND - (GROUND - y) * 0.9, round]
    }
    lean(rig, -4)
    tilt(rig, -19)
    eyes(rig, 0.22)
    shift(rig, [BROW], 1.2, 2.2)
  },
  // The brow lifts and the head comes up: something needs his attention.
  concerned(rig) {
    lean(rig, 2)
    tilt(rig, 5)
    shift(rig, [BROW], -2.2, -4.5)
    shift(rig, [DOME[0]], -0.8, -1.2)
    squash(rig, FAR_LENS, 1.12, 1.12)
    squash(rig, NEAR_LENS, 1.12, 1.12)
    shift(rig, [MOUSTACHE], 1, 1.5)
  },
  blink(rig) {
    eyes(rig, 0.16)
  }
}

function rigFor(pose: Pose): Rig {
  const rig = BASE.map((anchor) => [...anchor] as unknown as Anchor)
  BUILD[pose](rig)
  return rig
}

const fmt = (value: number): string => String(Math.round(value * 10) / 10)

/** The anchors as one path of cubic curves that passes through each of them. */
export function toPath(anchors: readonly Anchor[]): string {
  const last = anchors.length - 1
  const at = (index: number): Anchor => anchors[Math.max(0, Math.min(last, index))]
  let d = `M${fmt(anchors[0][0])} ${fmt(anchors[0][1])}`
  for (let index = 0; index < last; index++) {
    const before = at(index - 1)
    const from = at(index)
    const to = at(index + 1)
    const after = at(index + 2)
    const out = (from[2] ?? 1) / 6
    const into = (to[2] ?? 1) / 6
    d += `C${fmt(from[0] + (to[0] - before[0]) * out)} ${fmt(from[1] + (to[1] - before[1]) * out)} ${fmt(to[0] - (after[0] - from[0]) * into)} ${fmt(to[1] - (after[1] - from[1]) * into)} ${fmt(to[0])} ${fmt(to[1])}`
  }
  return d
}

/** The path of every pose. Equal in structure: same commands, in the same order. */
export const PATHS: Record<Pose, string> = Object.fromEntries(POSES.map((pose) => [pose, toPath(rigFor(pose))])) as Record<Pose, string>

/** Sleep: a small "z" that rises from him, a stroke of its own. */
export const Z_PATH = 'M84 22h8l-8 9h8'
/** Thought: a small spiral that turns above his head while he thinks. */
export const THOUGHT_PATH = 'M92 20c-1.6-1.4-4.3-.6-4.6 1.7-.3 2.6 2.2 4.7 5 4.2 3.6-.6 5.4-4.6 3.8-7.9-1.9-3.9-7.2-5-10.9-2.4'
