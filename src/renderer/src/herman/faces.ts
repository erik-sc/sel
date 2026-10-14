// The faces of Herman's council: small busts drawn in the same hand as he is, a few strokes
// each, every member in a colour of their own (a token of the palette, so it holds in both
// themes). Each face is a list of strokes; the component draws them one after the other.
// Pure: no DOM, unit tested.
import type { CouncilMemberId } from '@shared/council'

/** The drawing's coordinate space. */
export const FACE_VIEW_BOX = '0 0 64 64'

/** The colour each member is drawn in: a name of the palette (`--c-<name>`). */
export const MEMBER_COLORS: Record<CouncilMemberId, 'blue' | 'red' | 'orange' | 'purple' | 'green'> = {
  skeptic: 'blue',
  strategist: 'red',
  builder: 'orange',
  editor: 'purple',
  keeper: 'green'
}

/** Head and shoulders, the same for everyone: what makes a member is drawn on top. */
const HEAD = 'M32 13c6.2 0 10.6 5.4 10.6 12.6S38.2 38.5 32 38.5 21.4 32.8 21.4 25.6 25.8 13 32 13z'
const SHOULDERS = 'M9 63c1-9.6 7.6-15.2 16.6-16.8 2.2 2.6 4.4 3.8 6.4 3.8s4.2-1.2 6.4-3.8C47.4 47.8 54 53.4 55 63'

/**
 * Each member's strokes, drawn in order after the head and shoulders.
 *  - Cato, the Skeptic: one brow raised, a monocle on its chain, a mouth that is not convinced, a toga.
 *  - Sun, the Strategist: a topknot, eyes closed in thought, a long moustache, a high collar.
 *  - Ada, the Builder: a bob, goggles pushed up on the forehead, a pencil behind the ear, overall straps.
 *  - Iris, the Editor: a bun with a pen through it, square spectacles, a neat collar.
 *  - Mira, the Keeper: long hair with a leaf in it, eyes that smile, a shawl.
 */
const FEATURES: Record<CouncilMemberId, readonly string[]> = {
  skeptic: [
    'M22.6 20.4c3-3.6 6.2-5 9.4-5s6.4 1.4 9.4 5',
    'M25.4 22.6h4.8',
    'M34.2 21.4c1.6-2.4 4.4-2.6 6-.6',
    'M27.8 26.2h.1',
    'M37 26.2h.1',
    'M40.2 26.2a3.2 3.2 0 1 1-6.4 0 3.2 3.2 0 1 1 6.4 0z',
    'M39.8 28.4c2 3.8 1.8 8.4-.8 12',
    'M32 27v5.2l-1.6.6',
    'M28.4 35c2.4-.2 4.6-.5 6.8-1.4',
    'M20.4 47.8c9 5 18.6 9.4 29.6 15.2'
  ],
  strategist: [
    'M35.4 9.6a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 1 1 6.8 0z',
    'M22.6 21.6c2-5.4 5.4-8.2 9.4-8.2s7.4 2.8 9.4 8.2',
    'M25.6 26c1.2 1 2.8 1 4 0',
    'M34.4 26c1.2 1 2.8 1 4 0',
    'M32 27.2v3.4',
    'M32 32.4c-2.6 0-4.6 1.6-5.6 4.4-.6 2-.8 4-.6 6',
    'M32 32.4c2.6 0 4.6 1.6 5.6 4.4.6 2 .8 4 .6 6',
    'M26 45.6v3.6h12v-3.6',
    'M32 49.2l-6.4 13.8'
  ],
  builder: [
    'M21 29c-1.4-10 3.8-17 11-17s12.4 7 11 17c-.4 3-1.6 5-3 6.2',
    'M21 29c.4 3 1.6 5 3 6.2',
    'M30.4 18.6a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 1 1 5.6 0z',
    'M39.2 18.6a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 1 1 5.6 0z',
    'M30.4 18.6h3.2',
    'M27.6 26.6h.1',
    'M36.4 26.6h.1',
    'M28.6 31.8c2 1.8 4.8 1.8 6.8 0',
    'M43.6 22.4l5-7',
    'M25 48.6V63',
    'M39 48.6V63'
  ],
  editor: [
    'M21.8 25c.4-7.4 4.8-12 10.2-12 4.8 0 8.8 3.2 10.2 8.6-3.6-1.8-8-2.2-12-.8-3 1-5.8 2.4-8.4 4.2z',
    'M47 13.4a4 4 0 1 1-8 0 4 4 0 1 1 8 0z',
    'M38.6 8.4l10 9.4',
    'M24.2 24.8h5.8v3.6h-5.8z',
    'M34 24.8h5.8v3.6H34z',
    'M30 26.6h4',
    'M29.4 33h5.2',
    'M27 46.4l5 4.4 5-4.4'
  ],
  keeper: [
    'M21.6 26.6c-1-9.2 4.2-15 10.4-15s11.4 5.8 10.4 15c-.2 7.8 1.4 13.6 4.8 18.6',
    'M21.6 26.6c.2 7.8-1.4 13.6-4.8 18.6',
    'M32 11.6c-2 3-5.4 5.4-9.8 6.4',
    'M39.6 16c1.6-3.2 4.6-4.4 7.2-3.8-1 2.8-3.8 4.4-7.2 3.8z',
    'M25.6 26.4c1.2-1 2.8-1 4 0',
    'M34.4 26.4c1.2-1 2.8-1 4 0',
    'M28.6 31.8c2 1.8 4.8 1.8 6.8 0',
    'M13.6 52.4c6 4 12.2 6 18.4 6s12.4-2 18.4-6'
  ]
}

/** Every stroke of a member's face, in the order they are drawn. */
export function faceStrokes(member: CouncilMemberId): string[] {
  return [HEAD, SHOULDERS, ...FEATURES[member]]
}

/** A small curl that turns beside a face while that member thinks. */
export const FACE_THOUGHT_PATH = 'M54 9c-1-.9-2.7-.4-2.9 1.1-.2 1.6 1.4 2.9 3.1 2.6 2.2-.4 3.4-2.9 2.4-4.9-1.2-2.4-4.5-3.1-6.8-1.5'
