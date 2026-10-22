/**
 * A typed description of every design token in styles/tokens.css.
 * schema.test.ts parses tokens.css and fails when this list and the stylesheet disagree,
 * so every token stays editable in Settings → Appearance.
 */

export type TokenKind = 'color' | 'length' | 'number' | 'percent' | 'font' | 'shadow' | 'duration' | 'easing' | 'image' | 'text'

export const GROUPS = [
  'Wallpaper',
  'Glass',
  'Surfaces',
  'Text',
  'Lines',
  'Accents',
  'Typography',
  'Type scale',
  'Shape',
  'Layout & density',
  'Charts',
  'Shadows',
  'Motion',
  'Tag colours'
] as const

export type TokenGroup = (typeof GROUPS)[number]

export interface TokenDef {
  name: string
  label: string
  group: TokenGroup
  kind: TokenKind
  /** True when the token has a dark override in tokens.css. */
  themed: boolean
  light: string
  dark?: string
  min?: number
  max?: number
  step?: number
  unit?: string
  /** The value is emitted as `calc(<n>px * var(--font-scale))`; the editor exposes <n>. */
  scaled?: boolean
  /**
   * The `min` of an earlier version, when it was raised: a saved value from `floorFrom` up to `min`
   * reads as `min` (the setting keeps what it holds). Below `floorFrom` it is rejected, like any.
   */
  floorFrom?: number
  description?: string
}

type Extra = Partial<Pick<TokenDef, 'min' | 'max' | 'step' | 'unit' | 'scaled' | 'floorFrom' | 'description'>>

function def(group: TokenGroup, kind: TokenKind, name: string, label: string, light: string, dark?: string, extra: Extra = {}): TokenDef {
  const token: TokenDef = { name, label, group, kind, themed: dark !== undefined, light, ...extra }
  if (dark !== undefined) token.dark = dark
  return token
}

const color = (g: TokenGroup, name: string, label: string, light: string, dark?: string, description?: string) =>
  def(g, 'color', name, label, light, dark, description ? { description } : {})

const px = (g: TokenGroup, name: string, label: string, value: number, min: number, max: number, step = 1, description?: string) =>
  def(g, 'length', name, label, `${value}px`, undefined, { min, max, step, unit: 'px', description })

const size = (name: string, label: string, value: number, min: number, max: number, floorFrom?: number) =>
  def('Type scale', 'length', name, label, `calc(${value}px * var(--font-scale))`, undefined, {
    min,
    max,
    step: 1,
    unit: 'px',
    scaled: true,
    ...(floorFrom !== undefined ? { floorFrom } : {})
  })

const weight = (name: string, label: string, value: number) =>
  def('Typography', 'number', name, label, String(value), undefined, { min: 100, max: 900, step: 100 })

const shadow = (name: string, label: string, light: string, dark: string) => def('Shadows', 'shadow', name, label, light, dark)

const tag = (id: string, label: string, light: string, lightBg: string, dark: string, darkBg: string) => [
  color('Tag colours', `--c-${id}`, `${label} text`, light, dark),
  color('Tag colours', `--c-${id}-bg`, `${label} fill`, lightBg, darkBg)
]

export const TOKENS: TokenDef[] = [
  // ---- wallpaper ----
  color('Wallpaper', '--wall-base', 'Base colour', '#f0ede6', '#171614', 'The colour behind the wallpaper blobs.'),
  color('Wallpaper', '--wall-1', 'Colour 1', '#f7f4ee', '#1c1b19'),
  color('Wallpaper', '--wall-2', 'Colour 2', '#f1eee7', '#181715'),
  color('Wallpaper', '--wall-3', 'Colour 3', '#e8e4da', '#121110'),
  color('Wallpaper', '--wall-4', 'Colour 4', '#eeeae2', '#161513'),
  def('Wallpaper', 'number', '--wall-intensity', 'Colour intensity', '0.9', '0.9', { min: 0, max: 1, step: 0.01 }),
  def('Wallpaper', 'image', '--wall-image', 'Wallpaper image', 'none', undefined, {
    description: 'When set, the image replaces the colour wallpaper.'
  }),

  // ---- glass ----
  px('Glass', '--glass-blur', 'Blur', 0, 0, 80),
  def('Glass', 'percent', '--glass-saturate', 'Saturation', '100%', undefined, { min: 0, max: 300, step: 5, unit: '%' }),
  px('Glass', '--glass-thick-blur', 'Thick glass blur', 0, 0, 120, 1, 'Used by popovers and dialogs.'),
  color('Glass', '--glass-bg', 'Glass tint', 'rgba(250, 248, 244, 0.6)', 'rgba(29, 28, 26, 0.6)'),
  color('Glass', '--glass-thick-bg', 'Thick glass tint', '#fdfcfa', '#2b2927'),
  color('Glass', '--glass-border', 'Glass edge', 'rgba(70, 58, 36, 0)', 'rgba(232, 222, 200, 0)'),
  color('Glass', '--glass-highlight', 'Glass top highlight', 'rgba(255, 255, 255, 0)', 'rgba(255, 255, 255, 0)'),

  // ---- surfaces ----
  color('Surfaces', '--bg', 'Content background', '#faf8f4', '#1d1c1a'),
  color('Surfaces', '--bg-sidebar', 'Sidebar background', 'rgba(240, 237, 230, 0.5)', 'rgba(23, 22, 20, 0.5)'),
  color('Surfaces', '--bg-elevated', 'Elevated background', '#fdfcfa', '#2b2927'),
  color('Surfaces', '--bg-solid', 'Solid background', '#faf8f4', '#1d1c1a', 'Used where content must not show through.'),
  color('Surfaces', '--bg-hover', 'Hover', 'rgba(84, 72, 48, 0.07)', 'rgba(232, 222, 200, 0.06)'),
  color('Surfaces', '--bg-active', 'Pressed and selected', 'rgba(84, 72, 48, 0.12)', 'rgba(232, 222, 200, 0.11)'),
  color(
    'Surfaces',
    '--bg-menu-active',
    'Menu highlight',
    'rgba(84, 72, 48, 0.12)',
    'rgba(232, 222, 200, 0.11)',
    'The row under the pointer or the keys in a menu.'
  ),
  color('Surfaces', '--text-menu-active', 'Text on menu highlight', '#24221d', '#e8e3d9'),
  color('Surfaces', '--bg-menu-danger', 'Menu highlight, destructive', 'rgba(176, 67, 47, 0.13)', 'rgba(220, 122, 104, 0.16)'),
  color('Surfaces', '--text-menu-danger', 'Text on destructive highlight', '#b0432f', '#dc7a68'),
  color('Surfaces', '--fill-1', 'Fill 1 (strongest)', 'rgba(84, 72, 48, 0.16)', 'rgba(232, 222, 200, 0.18)'),
  color('Surfaces', '--fill-2', 'Fill 2', 'rgba(84, 72, 48, 0.12)', 'rgba(232, 222, 200, 0.14)'),
  color('Surfaces', '--fill-3', 'Fill 3', 'rgba(84, 72, 48, 0.09)', 'rgba(232, 222, 200, 0.1)'),
  color('Surfaces', '--fill-4', 'Fill 4 (subtlest)', 'rgba(84, 72, 48, 0.05)', 'rgba(232, 222, 200, 0.05)'),
  color('Surfaces', '--bg-code', 'Code background', 'rgba(84, 72, 48, 0.08)', 'rgba(232, 222, 200, 0.09)'),
  color('Surfaces', '--bg-sunk', 'Sunk surface', '#ebe7de', '#141311', 'Callouts and other blocks pressed into the page.'),
  color(
    'Surfaces',
    '--grid-dot',
    'Grid dots',
    'rgba(70, 58, 36, 0.16)',
    'rgba(232, 222, 200, 0.12)',
    'The dots on the ground behind the sidebar.'
  ),
  color('Surfaces', '--bg-selection', 'Selection', 'rgba(59, 79, 125, 0.2)', 'rgba(163, 177, 217, 0.28)'),
  color('Surfaces', '--scrim', 'Dialog backdrop', 'rgba(38, 34, 26, 0.24)', 'rgba(0, 0, 0, 0.42)'),

  // ---- text ----
  color('Text', '--text', 'Primary text', '#24221d', '#e8e3d9'),
  color('Text', '--text-secondary', 'Secondary text', '#615d54', '#a8a297'),
  color('Text', '--text-tertiary', 'Tertiary text', '#6d685d', '#959188'),
  color('Text', '--text-code', 'Inline code text', '#8a4530', '#d99a82'),
  def('Text', 'number', '--text-faded-opacity', 'Faded blocks in focus mode', '0.32', undefined, {
    min: 0.1,
    max: 1,
    step: 0.02,
    description: 'How much of the other blocks shows while focus mode fades all but the one you write in.'
  }),

  // ---- lines ----
  color('Lines', '--border', 'Separator', 'rgba(70, 58, 36, 0.11)', 'rgba(232, 222, 200, 0.09)'),
  color('Lines', '--border-strong', 'Strong separator', 'rgba(70, 58, 36, 0.24)', 'rgba(232, 222, 200, 0.2)'),
  color('Lines', '--frame', 'Frame', '#24221d', '#e8e3d9', 'The solid line around menus, dialogs and toasts.'),

  // ---- accents ----
  color('Accents', '--accent', 'Accent', '#3b4f7d', '#a3b1d9'),
  color('Accents', '--accent-text', 'Text on accent', '#fbf9f4', '#16181f'),
  color('Accents', '--accent-soft', 'Soft accent', 'rgba(59, 79, 125, 0.11)', 'rgba(163, 177, 217, 0.15)'),
  color('Accents', '--danger', 'Danger', '#b0432f', '#dc7a68'),
  color('Accents', '--success', 'Success', '#55794c', '#92b586'),
  color('Accents', '--moon', 'Moon', 'rgba(196, 163, 58, 0.22)', 'rgba(232, 214, 160, 0.3)', 'The lit part of the moon in the Sky.'),
  color('Accents', '--moon-lit', 'Moon, lit', '#d1b660', '#d1b660', 'The lit part of the moon, drawn solid in the pixel Sky.'),
  color(
    'Accents',
    '--copper',
    'Copper moon',
    'rgba(168, 84, 44, 0.32)',
    'rgba(214, 120, 74, 0.34)',
    'The moon on the night of an eclipse, in the Sky.'
  ),
  color('Accents', '--focus-ring', 'Focus ring', 'rgba(59, 79, 125, 0.7)', 'rgba(163, 177, 217, 0.7)'),

  // ---- typography ----
  def(
    'Typography',
    'font',
    '--font-sans',
    'Interface font',
    "'IBM Plex Mono', 'SF Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"
  ),
  def(
    'Typography',
    'font',
    '--font-display',
    'Title font',
    "Newsreader, 'Iowan Old Style', 'Sitka Heading', 'Palatino Linotype', Palatino, Georgia, serif"
  ),
  def(
    'Typography',
    'font',
    '--font-serif',
    'Serif font',
    "Newsreader, 'Iowan Old Style', 'Sitka Text', 'Palatino Linotype', Palatino, Georgia, serif"
  ),
  def('Typography', 'font', '--font-mono', 'Code font', "'IBM Plex Mono', 'SF Mono', ui-monospace, 'Cascadia Code', Consolas, monospace"),
  weight('--weight-regular', 'Regular weight', 400),
  weight('--weight-medium', 'Medium weight', 500),
  weight('--weight-semibold', 'Semibold weight', 600),
  weight('--weight-bold', 'Bold weight', 600),
  weight('--weight-title', 'Title weight', 400),
  def('Typography', 'number', '--weight-heading', 'Heading weight', '500', undefined, {
    min: 100,
    max: 900,
    step: 100,
    description: 'Heading 1. Smaller headings and dialog titles use it too, but never go above the semibold weight.'
  }),
  def('Typography', 'number', '--leading-ui', 'Interface line height', '1.3', undefined, { min: 1, max: 2, step: 0.05 }),
  def('Typography', 'number', '--leading-body', 'Body line height', '1.7', undefined, { min: 1, max: 2.2, step: 0.05 }),
  def('Typography', 'number', '--leading-title', 'Title line height', '1.2', undefined, { min: 0.9, max: 1.8, step: 0.05 }),
  def('Typography', 'number', '--code-scale', 'Inline code size', '0.88', undefined, { min: 0.6, max: 1.2, step: 0.01 }),
  def('Typography', 'length', '--tracking-title', 'Title letter spacing', '-0.006em', undefined, {
    min: -0.08,
    max: 0.08,
    step: 0.001,
    unit: 'em'
  }),
  def('Typography', 'length', '--tracking-ui', 'Interface letter spacing', '0em', undefined, {
    min: -0.05,
    max: 0.05,
    step: 0.001,
    unit: 'em'
  }),

  // ---- type scale ----
  def('Type scale', 'number', '--font-scale', 'Overall text size', '1', undefined, {
    min: 0.8,
    max: 1.5,
    step: 0.01,
    description: 'Multiplies every size below.'
  }),
  // Since 0.7.0 Tiny goes down to 10px (was 6) and Body to 12px (was 11): see floorFrom.
  size('--text-2xs', 'Tiny', 10, 10, 16, 6),
  size('--text-xs', 'Extra small', 11, 7, 18),
  size('--text-sm', 'Small', 12, 8, 20),
  size('--text-md', 'Medium', 13, 9, 22),
  size('--text-ui', 'Interface', 13, 10, 24),
  size('--text-body', 'Body', 17, 12, 28, 11),
  size('--text-lg', 'Large', 18, 12, 32),
  size('--text-h3', 'Heading 3', 20, 14, 36),
  size('--text-h2', 'Heading 2', 24, 16, 44),
  size('--text-h1', 'Heading 1', 30, 18, 56),
  size('--text-title', 'Page title', 40, 20, 72),
  size('--text-emoji-hero', 'Page icon', 64, 32, 128),

  // ---- shape ----
  px('Shape', '--radius-xs', 'Corner radius, extra small', 2, 0, 16),
  px('Shape', '--radius-s', 'Corner radius, small', 0, 0, 24),
  px('Shape', '--radius-m', 'Corner radius, medium', 0, 0, 32),
  px('Shape', '--radius-l', 'Corner radius, large', 0, 0, 40),
  px('Shape', '--radius-xl', 'Corner radius, extra large', 0, 0, 56),
  px('Shape', '--radius-pill', 'Pill radius', 0, 0, 999),
  px('Shape', '--hairline', 'Hairline thickness', 0.5, 0, 3, 0.5),

  // ---- layout & density ----
  px('Layout & density', '--sidebar-width', 'Sidebar width', 260, 180, 480, 2),
  px('Layout & density', '--topbar-height', 'Top bar height', 46, 32, 72),
  px('Layout & density', '--tabbar-height', 'Tab bar height', 40, 28, 64),
  px('Layout & density', '--page-width', 'Page width', 560, 480, 1400, 10),
  px('Layout & density', '--page-padding-x', 'Page side padding', 64, 0, 160, 2),
  px(
    'Layout & density',
    '--database-width',
    'Embedded database width',
    880,
    480,
    1800,
    10,
    'A database inside a page may grow this wide, beyond the text, when the window has room.'
  ),
  px('Layout & density', '--cover-height', 'Page cover height', 200, 80, 480, 4),
  px('Layout & density', '--panel-gap', 'Gap between panels', 8, 0, 32),
  px('Layout & density', '--control-height', 'Control height', 30, 20, 48),
  px('Layout & density', '--row-height', 'Row height', 32, 20, 52),
  px('Layout & density', '--table-row-height', 'Table row height', 36, 24, 64),
  px('Layout & density', '--block-gap', 'Gap between blocks', 5, 0, 16),
  px('Layout & density', '--indent', 'Indent', 26, 8, 56),

  // ---- charts ----
  px('Charts', '--chart-height', 'Chart height', 300, 160, 720, 10, 'Used by charts that do not set a height of their own.'),
  px('Charts', '--chart-bar-radius', 'Bar corner radius', 2, 0, 16),
  px('Charts', '--chart-stroke-width', 'Line thickness', 1.5, 1, 6, 0.5),
  px('Charts', '--chart-point-size', 'Point size', 2.5, 0, 8, 0.5, 'Radius of the dots on line and area charts.'),
  def('Charts', 'number', '--chart-grid-opacity', 'Grid line opacity', '0.7', undefined, { min: 0, max: 1, step: 0.05 }),
  def('Charts', 'number', '--chart-area-opacity', 'Area fill opacity', '0.15', undefined, { min: 0, max: 1, step: 0.05 }),
  def('Charts', 'percent', '--chart-series-strength', 'Series colour strength', '72%', '100%', {
    min: 20,
    max: 100,
    step: 1,
    unit: '%',
    description: 'Below 100%, series colours are softened towards the background.'
  }),

  // ---- shadows ----
  shadow('--shadow-panel', 'Panel shadow', '0 0 0 0 rgba(70, 58, 36, 0)', '0 0 0 0 rgba(0, 0, 0, 0)'),
  shadow('--shadow-card', 'Card shadow', '0 0 0 1px rgba(70, 58, 36, 0.24)', '0 0 0 1px rgba(232, 222, 200, 0.2)'),
  shadow('--shadow-popover', 'Popover shadow', '0 0 0 1px #24221d, 3px 3px 0 0 #24221d', '0 0 0 1px #e8e3d9, 3px 3px 0 0 #000000'),
  shadow('--shadow-control', 'Control shadow', '0 0 0 1px rgba(70, 58, 36, 0.32)', '0 0 0 1px rgba(232, 222, 200, 0.28)'),

  // ---- motion ----
  def('Motion', 'duration', '--duration-fast', 'Fast duration', '150ms', undefined, { min: 0, max: 600, step: 10, unit: 'ms' }),
  def('Motion', 'duration', '--duration', 'Standard duration', '300ms', undefined, { min: 0, max: 1000, step: 10, unit: 'ms' }),
  def('Motion', 'easing', '--ease', 'Easing curve', 'cubic-bezier(0.25, 0.7, 0.2, 1)', undefined, {
    description: 'Any CSS timing function.'
  }),

  // ---- tag colours ----
  ...tag('gray', 'Gray', '#63605a', 'rgba(110, 104, 92, 0.14)', '#b0aba0', 'rgba(170, 164, 150, 0.16)'),
  ...tag('brown', 'Brown', '#7a5632', 'rgba(128, 98, 70, 0.19)', '#c9a37e', 'rgba(160, 130, 104, 0.24)'),
  ...tag('orange', 'Orange', '#9b4f14', 'rgba(206, 132, 50, 0.2)', '#d39a5e', 'rgba(214, 142, 60, 0.2)'),
  ...tag('yellow', 'Yellow', '#75600c', 'rgba(196, 163, 58, 0.22)', '#d1b660', 'rgba(204, 174, 76, 0.18)'),
  ...tag('green', 'Green', '#456a38', 'rgba(98, 140, 80, 0.2)', '#9bbb8a', 'rgba(120, 160, 100, 0.2)'),
  ...tag('blue', 'Blue', '#3f5f8a', 'rgba(70, 112, 170, 0.18)', '#93acce', 'rgba(96, 138, 190, 0.22)'),
  ...tag('purple', 'Purple', '#6f528c', 'rgba(128, 94, 168, 0.18)', '#b3a0cc', 'rgba(146, 116, 184, 0.22)'),
  ...tag('pink', 'Pink', '#9a4268', 'rgba(196, 100, 144, 0.18)', '#cf9aae', 'rgba(200, 112, 148, 0.2)'),
  ...tag('red', 'Red', '#a3363a', 'rgba(196, 72, 72, 0.17)', '#e2827e', 'rgba(210, 90, 90, 0.2)')
]

/** By name. Has no prototype, so `TOKEN_MAP['constructor']` and the like are undefined. */
export const TOKEN_MAP: Record<string, TokenDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(TOKENS.map((token) => [token.name, token]))
)

export type ThemeName = 'light' | 'dark'

/** The value tokens.css gives a token in the given theme. */
export function defaultValue(token: TokenDef, theme: ThemeName): string {
  return theme === 'dark' && token.dark !== undefined ? token.dark : token.light
}
