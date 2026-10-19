/**
 * sel's own icons for pages and databases, stored as `icon:<name>`.
 *
 * Each one is a single unbroken line, the way Herman is drawn: the pen goes down once and
 * comes up once. So every entry is one path with one starting point, laid out on a 24 by 24
 * box and stroked, never filled. The subjects are the quiet things the app is about: paper,
 * ink, a desk, and what is outside the window. Pure: no DOM, so it runs in node tests.
 */

export const LINE_ICON_PREFIX = 'icon:'
/** The icons are laid out on a square of this side. */
export const LINE_ICON_BOX = 24

export const LINE_ICONS = {
  // ---- the desk ----
  page: 'M14 3.5H7v17h11v-13h-4v-4l4 4',
  book: 'M12 7C10 5.5 7 5 3.5 5.500v12c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.500v-12C17 5 14 5.5 12 7v12',
  feather: 'M4.5 20.5 8 16.500c2.7-.5 5.3-1.5 7.5-3.5 2.7-2.5 4.2-5.5 4.5-9-2.5 1-4.5 3-6 6.5-.8 1.8-2.5 3.8-6 6',
  brush: 'M19.5 4.5 10 14c-1.5 0-3 1-3 3 0 1.5-1 2.5-2.5 2.5 4 1 7.5-.5 7.5-3.500l9.5-9.500a1.4 1.4 0 0 0-2-2Z',
  drop: 'M12 3.500c3.5 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2-6 5.5-10Z',
  spectacles:
    'M2.5 9.5l1.5 3a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0c.6-1 1.4-1 2 0a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0l1.5-3',
  candle: 'M12 7.500c-2-1-1.8-2.5 0-4.5 1.8 2 2 3.5 0 4.500V10H9v10.500h6V10h-3',
  lantern: 'M12 2.500V5H9c-2 2-3 4.5-3 7s1 5 3 7h6c2-2 3-4.5 3-7s-1-5-3-7h-3',
  cup: 'M12 3c-1.5 1.5 1.5 3 0 4.500V11H5c0 4.5 3 8 7 8s7-3.5 7-8h-7',
  hourglass: 'M6.5 3.500h11c0 4-5.5 5.5-5.5 8.500s5.5 4.5 5.5 8.500h-11c0-4 5.5-5.5 5.5-8.500S6.5 7.5 6.5 3.500Z',
  bell: 'M12 3.500V5C8.7 5 6.5 7.7 6.5 11v4L5 17.500h14L17.5 15v-4c0-3.3-2.2-6-5.5-6',
  key: 'M12 11a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7v6h2.500H12v3.500h3',
  box: 'M12 21v-8.500L4 8l8-4.500L20 8l-8 4.500L20 8v8.500L12 21l-8-4.500V8',
  // ---- the garden ----
  enso: 'M17.5 6.200C14.5 3.4 9.4 3.6 6.4 6.8 3.2 10.2 3.6 15.6 7 18.600c3.4 3 8.6 2.6 11.4-.9 1.9-2.4 2.3-5.5 1.3-8.2',
  stones: 'M12 21a7 2.5 0 0 1 0-5 5 3 0 0 1 0-6 3 2.5 0 0 1 0-5 3 2.5 0 0 1 0 5 5 3 0 0 1 0 6 7 2.5 0 0 1 0 5Z',
  spiral: 'M12 12c0-1 1.5-1 1.5.3 0 1.6-2.6 2-3.3.2-.9-2.3 1.6-4.4 4-3.6 3 1 3.9 4.9 1.7 7.2-2.8 2.9-7.9 2-9.5-1.7-1.9-4.4 1.3-9.3 6-9.6',
  path: 'M8 21c6-2 8-4 4-6.500s-5-5 0-7c3-1.2 4-2.5 3.5-4.5',
  knot: 'M12 12c-2-3.5-4-5-6-5a5 5 0 0 0 0 10c2 0 4-1.5 6-5s4-5 6-5a5 5 0 0 1 0 10c-2 0-4-1.5-6-5Z',
  leaf: 'M5 19C5 11 10 5 19 5c0 9-6 14-14 14L14 10',
  sprout: 'M12 21v-9c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6 0-2.5 2-4.5 6-4.5 0 3-2 5-6 5',
  lotus: 'M12 20c-5 0-8-3-8.5-7 2.5 0 4.5 1 5.5 2.500C8 12 9.5 7.5 12 5c2.5 2.5 4 7 3 10.5 1-1.5 3-2.5 5.5-2.5-.5 4-3.5 7-8.5 7Z',
  bamboo: 'M10 21v-6h2.500H10V9h2.500H10V3.500c3 0 5.5 1.5 7 4.5-3 .5-5.5-.5-7-2.5',
  tree: 'M12 21v-4H5.500l4-4.500H7.500L12 3.500l4.5 9h-2l4 4.500H12',
  // ---- outside the window ----
  mountain: 'M2.5 19 9 7l3.5 6 2.5-3.5 6.5 9.500Z',
  wave: 'M2.5 15c2-5.5 6-7 8.5-4 1.5 1.9.2 4-1.5 3.5-1.8-.5-1.3-3.3 1-3.9 4.5-1.2 5 4.4 11 4.4',
  cloud: 'M7 18.500a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.300A4.7 4.7 0 0 1 17 18.500Z',
  moon: 'M16 4a8.5 8.5 0 1 0 4 12.500A7 7 0 0 1 16 4Z',
  star: 'M12 3.5 17 19.5 4 9.500h16L7 19.500Z',
  fish: 'M3 12c3-4.5 9-5.5 13-2.500l4.5-3.500v12L16 14.500C12 17.5 6 16.5 3 12Z',
  bird: 'M2.5 13c1.5-4 4-5.5 6.5-4.5 1.5.6 2.5 2 3 4 .5-2 1.5-3.4 3-4 2.5-1 5 .5 6.5 4.5',
  boat: 'M12 3.500l6 8h-6v-8 10.500H3l3 5h12l3-5h-9',
  house: 'M3.5 11.5 12 4l8.5 7.500H18v8.500H6v-8.500H3.5',
  heart: 'M12 20C5 15 3 11.5 3 8.500a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 3-2 6.5-9 11.500Z'
} as const

export type LineIconName = keyof typeof LINE_ICONS
export const LINE_ICON_NAMES = Object.keys(LINE_ICONS) as LineIconName[]

/** The stored icon value of one of sel's own icons. */
export function lineIconValue(name: LineIconName): string {
  return LINE_ICON_PREFIX + name
}

/** The path of the icon an icon value names, or undefined when it names none. */
export function lineIconPath(icon: string): string | undefined {
  if (!icon.startsWith(LINE_ICON_PREFIX)) return undefined
  const name = icon.slice(LINE_ICON_PREFIX.length)
  return Object.hasOwn(LINE_ICONS, name) ? LINE_ICONS[name as LineIconName] : undefined
}
