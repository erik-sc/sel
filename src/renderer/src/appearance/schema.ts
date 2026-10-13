/**
 * A typed description of every design token in styles/tokens.css.
 * schema.test.ts parses tokens.css and fails when this list and the stylesheet disagree,
 * so every token stays editable in Settings → Appearance.
 */

export type TokenKind =
  | 'color'
  | 'length'
  | 'number'
  | 'percent'
  | 'font'
  | 'shadow'
  | 'duration'
  | 'easing'
  | 'image'
  | 'text'

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
  description?: string
}

type Extra = Partial<Pick<TokenDef, 'min' | 'max' | 'step' | 'unit' | 'scaled' | 'description'>>

function def(
  group: TokenGroup,
  kind: TokenKind,
  name: string,
  label: string,
  light: string,
  dark?: string,
  extra: Extra = {}
): TokenDef {
  const token: TokenDef = { name, label, group, kind, themed: dark !== undefined, light, ...extra }
  if (dark !== undefined) token.dark = dark
  return token
}

const color = (g: TokenGroup, name: string, label: string, light: string, dark?: string, description?: string) =>
  def(g, 'color', name, label, light, dark, description ? { description } : {})

const px = (
  g: TokenGroup,
  name: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step = 1,
  description?: string
) => def(g, 'length', name, label, `${value}px`, undefined, { min, max, step, unit: 'px', description })

const size = (name: string, label: string, value: number, min: number, max: number) =>
  def('Type scale', 'length', name, label, `calc(${value}px * var(--font-scale))`, undefined, {
    min,
    max,
    step: 1,
    unit: 'px',
    scaled: true
  })

const weight = (name: string, label: string, value: number) =>
  def('Typography', 'number', name, label, String(value), undefined, { min: 100, max: 900, step: 100 })

const shadow = (name: string, label: string, light: string, dark: string) =>
  def('Shadows', 'shadow', name, label, light, dark)

const tag = (id: string, label: string, light: string, lightBg: string, dark: string, darkBg: string) => [
  color('Tag colours', `--c-${id}`, `${label} text`, light, dark),
  color('Tag colours', `--c-${id}-bg`, `${label} fill`, lightBg, darkBg)
]

export const TOKENS: TokenDef[] = [
  // ---- wallpaper ----
  color('Wallpaper', '--wall-base', 'Base colour', '#eef1f8', '#0b0c14', 'The colour behind the wallpaper blobs.'),
  color('Wallpaper', '--wall-1', 'Colour 1', '#a8c8ff', '#1b3f8f'),
  color('Wallpaper', '--wall-2', 'Colour 2', '#ffc3dc', '#7a1f5c'),
  color('Wallpaper', '--wall-3', 'Colour 3', '#c7b8ff', '#45288f'),
  color('Wallpaper', '--wall-4', 'Colour 4', '#b6f0e2', '#0f5c58'),
  def('Wallpaper', 'number', '--wall-intensity', 'Colour intensity', '0.85', '0.7', { min: 0, max: 1, step: 0.01 }),
  def('Wallpaper', 'image', '--wall-image', 'Wallpaper image', 'none', undefined, {
    description: 'When set, the image replaces the colour wallpaper.'
  }),

  // ---- glass ----
  px('Glass', '--glass-blur', 'Blur', 28, 0, 80),
  def('Glass', 'percent', '--glass-saturate', 'Saturation', '180%', undefined, { min: 0, max: 300, step: 5, unit: '%' }),
  px('Glass', '--glass-thick-blur', 'Thick glass blur', 44, 0, 120, 1, 'Used by popovers and dialogs.'),
  color('Glass', '--glass-bg', 'Glass tint', 'rgba(255, 255, 255, 0.55)', 'rgba(40, 40, 46, 0.5)'),
  color('Glass', '--glass-thick-bg', 'Thick glass tint', 'rgba(248, 248, 252, 0.8)', 'rgba(38, 38, 44, 0.78)'),
  color('Glass', '--glass-border', 'Glass edge', 'rgba(255, 255, 255, 0.7)', 'rgba(255, 255, 255, 0.12)'),
  color('Glass', '--glass-highlight', 'Glass top highlight', 'rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.14)'),

  // ---- surfaces ----
  color('Surfaces', '--bg', 'Content background', 'rgba(255, 255, 255, 0.62)', 'rgba(28, 28, 32, 0.58)'),
  color('Surfaces', '--bg-sidebar', 'Sidebar background', 'rgba(255, 255, 255, 0.36)', 'rgba(30, 30, 36, 0.4)'),
  color('Surfaces', '--bg-elevated', 'Elevated background', 'rgba(250, 250, 252, 0.78)', 'rgba(44, 44, 50, 0.76)'),
  color('Surfaces', '--bg-solid', 'Solid background', '#ffffff', '#1c1c1e', 'Used where content must not show through.'),
  color('Surfaces', '--bg-hover', 'Hover', 'rgba(120, 120, 128, 0.12)', 'rgba(120, 120, 128, 0.2)'),
  color('Surfaces', '--bg-active', 'Pressed and selected', 'rgba(120, 120, 128, 0.2)', 'rgba(120, 120, 128, 0.34)'),
  color('Surfaces', '--fill-1', 'Fill 1 (strongest)', 'rgba(120, 120, 128, 0.2)', 'rgba(120, 120, 128, 0.36)'),
  color('Surfaces', '--fill-2', 'Fill 2', 'rgba(120, 120, 128, 0.16)', 'rgba(120, 120, 128, 0.32)'),
  color('Surfaces', '--fill-3', 'Fill 3', 'rgba(118, 118, 128, 0.12)', 'rgba(118, 118, 128, 0.24)'),
  color('Surfaces', '--fill-4', 'Fill 4 (subtlest)', 'rgba(116, 116, 128, 0.08)', 'rgba(118, 118, 128, 0.18)'),
  color('Surfaces', '--bg-code', 'Code background', 'rgba(118, 118, 128, 0.12)', 'rgba(118, 118, 128, 0.24)'),
  color('Surfaces', '--bg-selection', 'Selection', 'rgba(0, 122, 255, 0.24)', 'rgba(10, 132, 255, 0.36)'),
  color('Surfaces', '--scrim', 'Dialog backdrop', 'rgba(0, 0, 0, 0.22)', 'rgba(0, 0, 0, 0.45)'),

  // ---- text ----
  color('Text', '--text', 'Primary text', 'rgba(0, 0, 0, 0.88)', 'rgba(255, 255, 255, 0.92)'),
  color('Text', '--text-secondary', 'Secondary text', 'rgba(60, 60, 67, 0.62)', 'rgba(235, 235, 245, 0.6)'),
  color('Text', '--text-tertiary', 'Tertiary text', 'rgba(60, 60, 67, 0.32)', 'rgba(235, 235, 245, 0.3)'),
  color('Text', '--text-code', 'Inline code text', '#d70015', '#ff6961'),

  // ---- lines ----
  color('Lines', '--border', 'Separator', 'rgba(60, 60, 67, 0.16)', 'rgba(255, 255, 255, 0.1)'),
  color('Lines', '--border-strong', 'Strong separator', 'rgba(60, 60, 67, 0.3)', 'rgba(255, 255, 255, 0.2)'),

  // ---- accents ----
  color('Accents', '--accent', 'Accent', '#007aff', '#0a84ff'),
  color('Accents', '--accent-text', 'Text on accent', '#ffffff', '#ffffff'),
  color('Accents', '--accent-soft', 'Soft accent', 'rgba(0, 122, 255, 0.14)', 'rgba(10, 132, 255, 0.22)'),
  color('Accents', '--danger', 'Danger', '#ff3b30', '#ff453a'),
  color('Accents', '--success', 'Success', '#34c759', '#30d158'),
  color('Accents', '--focus-ring', 'Focus ring', 'rgba(0, 122, 255, 0.5)', 'rgba(10, 132, 255, 0.6)'),

  // ---- typography ----
  def(
    'Typography',
    'font',
    '--font-sans',
    'Interface font',
    "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
  ),
  def(
    'Typography',
    'font',
    '--font-display',
    'Title font',
    "'SF Pro Rounded', ui-rounded, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif"
  ),
  def('Typography', 'font', '--font-serif', 'Serif font', "'New York', ui-serif, Georgia, 'Times New Roman', serif"),
  def('Typography', 'font', '--font-mono', 'Code font', "'SF Mono', ui-monospace, 'Cascadia Code', Consolas, monospace"),
  weight('--weight-regular', 'Regular weight', 400),
  weight('--weight-medium', 'Medium weight', 500),
  weight('--weight-semibold', 'Semibold weight', 600),
  weight('--weight-bold', 'Bold weight', 700),
  weight('--weight-title', 'Title weight', 700),
  def('Typography', 'number', '--leading-ui', 'Interface line height', '1.3', undefined, { min: 1, max: 2, step: 0.05 }),
  def('Typography', 'number', '--leading-body', 'Body line height', '1.55', undefined, { min: 1, max: 2.2, step: 0.05 }),
  def('Typography', 'number', '--leading-title', 'Title line height', '1.15', undefined, { min: 0.9, max: 1.8, step: 0.05 }),
  def('Typography', 'number', '--code-scale', 'Inline code size', '0.88', undefined, { min: 0.6, max: 1.2, step: 0.01 }),
  def('Typography', 'length', '--tracking-title', 'Title letter spacing', '-0.022em', undefined, {
    min: -0.08,
    max: 0.08,
    step: 0.001,
    unit: 'em'
  }),
  def('Typography', 'length', '--tracking-ui', 'Interface letter spacing', '-0.006em', undefined, {
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
  size('--text-2xs', 'Tiny', 10, 6, 16),
  size('--text-xs', 'Extra small', 11, 7, 18),
  size('--text-sm', 'Small', 12, 8, 20),
  size('--text-md', 'Medium', 13, 9, 22),
  size('--text-ui', 'Interface', 14, 10, 24),
  size('--text-body', 'Body', 16, 11, 28),
  size('--text-lg', 'Large', 18, 12, 32),
  size('--text-h3', 'Heading 3', 20, 14, 36),
  size('--text-h2', 'Heading 2', 24, 16, 44),
  size('--text-h1', 'Heading 1', 30, 18, 56),
  size('--text-title', 'Page title', 40, 20, 72),
  size('--text-emoji-hero', 'Page icon', 72, 32, 128),

  // ---- shape ----
  px('Shape', '--radius-xs', 'Corner radius, extra small', 5, 0, 16),
  px('Shape', '--radius-s', 'Corner radius, small', 8, 0, 24),
  px('Shape', '--radius-m', 'Corner radius, medium', 12, 0, 32),
  px('Shape', '--radius-l', 'Corner radius, large', 18, 0, 40),
  px('Shape', '--radius-xl', 'Corner radius, extra large', 26, 0, 56),
  px('Shape', '--radius-pill', 'Pill radius', 999, 0, 999),
  px('Shape', '--hairline', 'Hairline thickness', 0.5, 0, 3, 0.5),

  // ---- layout & density ----
  px('Layout & density', '--sidebar-width', 'Sidebar width', 260, 180, 480, 2),
  px('Layout & density', '--topbar-height', 'Top bar height', 46, 32, 72),
  px('Layout & density', '--tabbar-height', 'Tab bar height', 40, 28, 64),
  px('Layout & density', '--page-width', 'Page width', 720, 480, 1400, 10),
  px('Layout & density', '--page-padding-x', 'Page side padding', 64, 0, 160, 2),
  px('Layout & density', '--cover-height', 'Page cover height', 200, 80, 480, 4),
  px('Layout & density', '--panel-gap', 'Gap between panels', 8, 0, 32),
  px('Layout & density', '--control-height', 'Control height', 30, 20, 48),
  px('Layout & density', '--row-height', 'Row height', 32, 20, 52),
  px('Layout & density', '--table-row-height', 'Table row height', 36, 24, 64),
  px('Layout & density', '--block-gap', 'Gap between blocks', 2, 0, 16),
  px('Layout & density', '--indent', 'Indent', 26, 8, 56),

  // ---- charts ----
  px('Charts', '--chart-height', 'Chart height', 300, 160, 720, 10, 'Used by charts that do not set a height of their own.'),
  px('Charts', '--chart-bar-radius', 'Bar corner radius', 4, 0, 16),
  px('Charts', '--chart-stroke-width', 'Line thickness', 2, 1, 6, 0.5),
  px('Charts', '--chart-point-size', 'Point size', 3, 0, 8, 0.5, 'Radius of the dots on line and area charts.'),
  def('Charts', 'number', '--chart-grid-opacity', 'Grid line opacity', '1', undefined, { min: 0, max: 1, step: 0.05 }),
  def('Charts', 'number', '--chart-area-opacity', 'Area fill opacity', '0.2', undefined, { min: 0, max: 1, step: 0.05 }),

  // ---- shadows ----
  shadow(
    '--shadow-panel',
    'Panel shadow',
    '0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 28px rgba(31, 38, 80, 0.1)',
    '0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 34px rgba(0, 0, 0, 0.36)'
  ),
  shadow(
    '--shadow-card',
    'Card shadow',
    '0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(31, 38, 80, 0.06)',
    '0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 10px rgba(0, 0, 0, 0.24)'
  ),
  shadow(
    '--shadow-popover',
    'Popover shadow',
    '0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 10px 30px rgba(31, 38, 80, 0.18), 0 24px 70px rgba(31, 38, 80, 0.16)',
    '0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 34px rgba(0, 0, 0, 0.5), 0 28px 80px rgba(0, 0, 0, 0.5)'
  ),
  shadow(
    '--shadow-control',
    'Control shadow',
    '0 1px 2px rgba(0, 0, 0, 0.1), 0 0 0 0.5px rgba(0, 0, 0, 0.06)',
    '0 1px 2px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(255, 255, 255, 0.08)'
  ),

  // ---- motion ----
  def('Motion', 'duration', '--duration-fast', 'Fast duration', '120ms', undefined, { min: 0, max: 600, step: 10, unit: 'ms' }),
  def('Motion', 'duration', '--duration', 'Standard duration', '220ms', undefined, { min: 0, max: 1000, step: 10, unit: 'ms' }),
  def('Motion', 'easing', '--ease', 'Easing curve', 'cubic-bezier(0.32, 0.72, 0, 1)', undefined, {
    description: 'Any CSS timing function.'
  }),

  // ---- tag colours ----
  ...tag('gray', 'Gray', '#6e6e73', 'rgba(142, 142, 147, 0.2)', '#aeaeb2', 'rgba(142, 142, 147, 0.3)'),
  ...tag('brown', 'Brown', '#8f6a4b', 'rgba(162, 132, 94, 0.22)', '#c9a37c', 'rgba(172, 142, 104, 0.3)'),
  ...tag('orange', 'Orange', '#c25e00', 'rgba(255, 149, 0, 0.2)', '#ff9f0a', 'rgba(255, 159, 10, 0.24)'),
  ...tag('yellow', 'Yellow', '#9a7400', 'rgba(255, 204, 0, 0.26)', '#ffd60a', 'rgba(255, 214, 10, 0.2)'),
  ...tag('green', 'Green', '#1f8a3d', 'rgba(52, 199, 89, 0.2)', '#30d158', 'rgba(48, 209, 88, 0.22)'),
  ...tag('blue', 'Blue', '#0063d1', 'rgba(0, 122, 255, 0.16)', '#4da3ff', 'rgba(10, 132, 255, 0.26)'),
  ...tag('purple', 'Purple', '#8a3fc4', 'rgba(175, 82, 222, 0.18)', '#bf5af2', 'rgba(191, 90, 242, 0.24)'),
  ...tag('pink', 'Pink', '#d6246a', 'rgba(255, 45, 85, 0.16)', '#ff5c8a', 'rgba(255, 55, 95, 0.24)'),
  ...tag('red', 'Red', '#d92c22', 'rgba(255, 59, 48, 0.16)', '#ff6961', 'rgba(255, 69, 58, 0.24)')
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
