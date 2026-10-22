/**
 * Ready-made looks, each expressed as overrides on top of the defaults in tokens.css.
 *
 * The defaults are the Zen look, so "Zen" overrides nothing. The frosted look that used to be
 * the default lives on as "Glass": GLASS below lists the original value of every token Zen
 * changed. The presets that were designed over that look (Clear glass … High contrast) spread
 * GLASS first and then their own overrides, so each one looks exactly as it always did.
 * When a default in tokens.css changes, add its previous value to GLASS.
 */

export interface Preset {
  id: string
  name: string
  description: string
  light: Record<string, string>
  dark: Record<string, string>
  shared: Record<string, string>
  /** The window style (skins.ts) the preset turns on; none when absent. */
  skin?: string
}

/** Accent-derived tokens for one theme. `rgb` is the accent as "r, g, b". */
function accent(hex: string, rgb: string, text: string, soft: number, ring: number, selection: number) {
  return {
    '--accent': hex,
    '--accent-text': text,
    '--accent-soft': `rgba(${rgb}, ${soft})`,
    '--focus-ring': `rgba(${rgb}, ${ring})`,
    '--bg-selection': `rgba(${rgb}, ${selection})`
  }
}

/** The solid bar of accent the Glass looks highlight a menu row with. */
function menuBar(hex: string, text: string) {
  return { '--bg-menu-active': hex, '--text-menu-active': text, '--text-menu-danger': text }
}

function wallpaper(base: string, c1: string, c2: string, c3: string, c4: string) {
  return { '--wall-base': base, '--wall-1': c1, '--wall-2': c2, '--wall-3': c3, '--wall-4': c4 }
}

/** A text size token's value. */
const scaled = (px: number) => `calc(${px}px * var(--font-scale))`

/** Every corner radius but the pill's. */
function corners(xs: number, s: number, m: number, l: number, xl: number) {
  return { '--radius-xs': `${xs}px`, '--radius-s': `${s}px`, '--radius-m': `${m}px`, '--radius-l': `${l}px`, '--radius-xl': `${xl}px` }
}

function fonts(sans: string, display = sans, serif = sans, mono = "'SF Mono', ui-monospace, 'Cascadia Code', Consolas, monospace") {
  return { '--font-sans': sans, '--font-display': display, '--font-serif': serif, '--font-mono': mono }
}

/** The smaller interface sizes of the desktops of the 1990s and 2000s. */
const RETRO_TYPE = {
  '--text-sm': scaled(11),
  '--text-md': scaled(12),
  '--text-ui': scaled(12),
  '--text-body': scaled(15),
  '--tracking-title': '0em',
  '--tracking-ui': '0em'
}

/** Opaque surfaces: nothing to frost. */
const NO_BLUR = { '--glass-blur': '0px', '--glass-thick-blur': '0px', '--glass-saturate': '100%' }

const NO_EDGE = { '--glass-border': 'rgba(0, 0, 0, 0)', '--glass-highlight': 'rgba(255, 255, 255, 0)' }

/** Windows 98 bevels, as shadows: raised from the light colours on the top left. */
function bevel(dark: string, hi: string, shadow: string, light: string) {
  return `inset -1px -1px 0 ${dark}, inset 1px 1px 0 ${hi}, inset -2px -2px 0 ${shadow}, inset 2px 2px 0 ${light}`
}

/** One theme of the Terminal look: everything in one phosphor colour on black. */
function phosphor(hex: string, rgb: string, ink: string, dim: string, faint: string, code: string, screen: string, raised: string) {
  const glow = (alpha: number) => `rgba(${rgb}, ${alpha})`
  return {
    ...wallpaper(screen, screen, screen, screen, screen),
    '--wall-intensity': '0',
    '--bg': screen,
    '--bg-solid': screen,
    '--bg-sidebar': screen,
    '--bg-elevated': raised,
    '--glass-bg': screen,
    '--glass-thick-bg': raised,
    '--glass-border': glow(0.35),
    '--glass-highlight': 'rgba(255, 255, 255, 0)',
    '--bg-hover': glow(0.1),
    '--bg-active': glow(0.18),
    '--fill-1': glow(0.22),
    '--fill-2': glow(0.16),
    '--fill-3': glow(0.1),
    '--fill-4': glow(0.06),
    '--bg-code': glow(0.1),
    '--scrim': 'rgba(0, 0, 0, 0.6)',
    '--text': hex,
    '--text-secondary': dim,
    '--text-tertiary': faint,
    '--text-code': code,
    '--border': glow(0.25),
    '--border-strong': glow(0.55),
    ...accent(hex, rgb, ink, 0.16, 0.8, 0.35),
    ...menuBar(hex, ink),
    '--bg-menu-danger': '#ff5a3c',
    '--danger': '#ff5a3c',
    '--success': hex,
    '--shadow-panel': '0 0 0 0 rgba(0, 0, 0, 0)',
    '--shadow-card': `0 0 0 1px ${glow(0.3)}`,
    '--shadow-popover': `0 0 0 1px ${glow(0.5)}, 0 0 24px ${glow(0.15)}`,
    '--shadow-control': `0 0 0 1px ${glow(0.4)}`
  }
}

// <glass-defaults> generated: every token whose Zen default differs from the original Glass default
const GLASS = {
  shared: {
    '--font-display': "'SF Pro Rounded', ui-rounded, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
    '--font-serif': "'New York', ui-serif, Georgia, 'Times New Roman', serif",
    '--text-body': 'calc(16px * var(--font-scale))',
    '--text-emoji-hero': 'calc(72px * var(--font-scale))',
    '--weight-medium': '500',
    '--weight-bold': '700',
    '--weight-title': '700',
    '--weight-heading': '700',
    '--leading-body': '1.55',
    '--leading-title': '1.15',
    '--tracking-title': '-0.022em',
    '--tracking-ui': '-0.006em',
    '--radius-xs': '5px',
    '--radius-s': '8px',
    '--radius-m': '12px',
    '--radius-l': '18px',
    '--radius-xl': '26px',
    '--page-width': '720px',
    '--database-width': '720px',
    '--block-gap': '2px',
    '--glass-saturate': '180%',
    '--glass-thick-blur': '44px',
    '--chart-bar-radius': '4px',
    '--chart-stroke-width': '2px',
    '--chart-point-size': '3px',
    '--chart-grid-opacity': '1',
    '--chart-area-opacity': '0.2',
    '--duration-fast': '120ms',
    '--duration': '220ms',
    '--ease': 'cubic-bezier(0.32, 0.72, 0, 1)'
  },
  light: {
    '--wall-base': '#eef1f8',
    '--wall-1': '#a8c8ff',
    '--wall-2': '#ffc3dc',
    '--wall-3': '#c7b8ff',
    '--wall-4': '#b6f0e2',
    '--wall-intensity': '0.85',
    '--chart-series-strength': '100%',
    '--bg': 'rgba(255, 255, 255, 0.62)',
    '--bg-sidebar': 'rgba(255, 255, 255, 0.36)',
    '--bg-elevated': 'rgba(250, 250, 252, 0.78)',
    '--bg-solid': '#ffffff',
    '--glass-bg': 'rgba(255, 255, 255, 0.55)',
    '--glass-thick-bg': 'rgba(248, 248, 252, 0.8)',
    '--glass-border': 'rgba(255, 255, 255, 0.7)',
    '--glass-highlight': 'rgba(255, 255, 255, 0.9)',
    '--bg-hover': 'rgba(120, 120, 128, 0.12)',
    '--bg-active': 'rgba(120, 120, 128, 0.2)',
    '--bg-menu-active': '#007aff',
    '--text-menu-active': '#ffffff',
    '--bg-menu-danger': '#ff3b30',
    '--text-menu-danger': '#ffffff',
    '--fill-1': 'rgba(120, 120, 128, 0.2)',
    '--fill-2': 'rgba(120, 120, 128, 0.16)',
    '--fill-3': 'rgba(118, 118, 128, 0.12)',
    '--fill-4': 'rgba(116, 116, 128, 0.08)',
    '--bg-code': 'rgba(118, 118, 128, 0.12)',
    '--bg-selection': 'rgba(0, 122, 255, 0.24)',
    '--scrim': 'rgba(0, 0, 0, 0.22)',
    '--text': 'rgba(0, 0, 0, 0.88)',
    '--text-secondary': 'rgba(60, 60, 67, 0.88)',
    '--text-tertiary': 'rgba(60, 60, 67, 0.8)',
    '--text-code': '#d70015',
    '--border': 'rgba(60, 60, 67, 0.16)',
    '--border-strong': 'rgba(60, 60, 67, 0.3)',
    '--accent': '#007aff',
    '--accent-text': '#ffffff',
    '--accent-soft': 'rgba(0, 122, 255, 0.14)',
    '--danger': '#ff3b30',
    '--success': '#34c759',
    '--focus-ring': '#006ee6',
    '--shadow-panel': '0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 28px rgba(31, 38, 80, 0.1)',
    '--shadow-card': '0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(31, 38, 80, 0.06)',
    '--shadow-popover': '0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 10px 30px rgba(31, 38, 80, 0.18), 0 24px 70px rgba(31, 38, 80, 0.16)',
    '--shadow-control': '0 1px 2px rgba(0, 0, 0, 0.1), 0 0 0 0.5px rgba(0, 0, 0, 0.06)',
    '--c-gray': '#6e6e73',
    '--c-gray-bg': 'rgba(142, 142, 147, 0.2)',
    '--c-brown': '#8f6a4b',
    '--c-brown-bg': 'rgba(162, 132, 94, 0.22)',
    '--c-orange': '#c25e00',
    '--c-orange-bg': 'rgba(255, 149, 0, 0.2)',
    '--c-yellow': '#9a7400',
    '--c-yellow-bg': 'rgba(255, 204, 0, 0.26)',
    '--c-green': '#1f8a3d',
    '--c-green-bg': 'rgba(52, 199, 89, 0.2)',
    '--c-blue': '#0063d1',
    '--c-blue-bg': 'rgba(0, 122, 255, 0.16)',
    '--c-purple': '#8a3fc4',
    '--c-purple-bg': 'rgba(175, 82, 222, 0.18)',
    '--c-pink': '#d6246a',
    '--c-pink-bg': 'rgba(255, 45, 85, 0.16)',
    '--c-red': '#d92c22',
    '--c-red-bg': 'rgba(255, 59, 48, 0.16)'
  },
  dark: {
    '--wall-base': '#0b0c14',
    '--wall-1': '#1b3f8f',
    '--wall-2': '#7a1f5c',
    '--wall-3': '#45288f',
    '--wall-4': '#0f5c58',
    '--wall-intensity': '0.7',
    '--chart-series-strength': '100%',
    '--bg': 'rgba(28, 28, 32, 0.58)',
    '--bg-sidebar': 'rgba(30, 30, 36, 0.4)',
    '--bg-elevated': 'rgba(44, 44, 50, 0.76)',
    '--bg-solid': '#1c1c1e',
    '--glass-bg': 'rgba(40, 40, 46, 0.5)',
    '--glass-thick-bg': 'rgba(38, 38, 44, 0.78)',
    '--glass-border': 'rgba(255, 255, 255, 0.12)',
    '--glass-highlight': 'rgba(255, 255, 255, 0.14)',
    '--bg-hover': 'rgba(120, 120, 128, 0.2)',
    '--bg-active': 'rgba(120, 120, 128, 0.34)',
    '--bg-menu-active': '#0a84ff',
    '--text-menu-active': '#ffffff',
    '--bg-menu-danger': '#ff453a',
    '--text-menu-danger': '#ffffff',
    '--fill-1': 'rgba(120, 120, 128, 0.36)',
    '--fill-2': 'rgba(120, 120, 128, 0.32)',
    '--fill-3': 'rgba(118, 118, 128, 0.24)',
    '--fill-4': 'rgba(118, 118, 128, 0.18)',
    '--bg-code': 'rgba(118, 118, 128, 0.24)',
    '--bg-selection': 'rgba(10, 132, 255, 0.36)',
    '--scrim': 'rgba(0, 0, 0, 0.45)',
    '--text': 'rgba(255, 255, 255, 0.92)',
    '--text-secondary': 'rgba(235, 235, 245, 0.74)',
    '--text-tertiary': 'rgba(235, 235, 245, 0.62)',
    '--text-code': '#ff6961',
    '--border': 'rgba(255, 255, 255, 0.1)',
    '--border-strong': 'rgba(255, 255, 255, 0.2)',
    '--accent': '#0a84ff',
    '--accent-text': '#ffffff',
    '--accent-soft': 'rgba(10, 132, 255, 0.22)',
    '--danger': '#ff453a',
    '--success': '#30d158',
    '--focus-ring': '#2c95ff',
    '--shadow-panel': '0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 34px rgba(0, 0, 0, 0.36)',
    '--shadow-card': '0 1px 2px rgba(0, 0, 0, 0.3), 0 2px 10px rgba(0, 0, 0, 0.24)',
    '--shadow-popover': '0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 34px rgba(0, 0, 0, 0.5), 0 28px 80px rgba(0, 0, 0, 0.5)',
    '--shadow-control': '0 1px 2px rgba(0, 0, 0, 0.4), 0 0 0 0.5px rgba(255, 255, 255, 0.08)',
    '--c-gray': '#aeaeb2',
    '--c-gray-bg': 'rgba(142, 142, 147, 0.3)',
    '--c-brown': '#c9a37c',
    '--c-brown-bg': 'rgba(172, 142, 104, 0.3)',
    '--c-orange': '#ff9f0a',
    '--c-orange-bg': 'rgba(255, 159, 10, 0.24)',
    '--c-yellow': '#ffd60a',
    '--c-yellow-bg': 'rgba(255, 214, 10, 0.2)',
    '--c-green': '#30d158',
    '--c-green-bg': 'rgba(48, 209, 88, 0.22)',
    '--c-blue': '#4da3ff',
    '--c-blue-bg': 'rgba(10, 132, 255, 0.26)',
    '--c-purple': '#bf5af2',
    '--c-purple-bg': 'rgba(191, 90, 242, 0.24)',
    '--c-pink': '#ff5c8a',
    '--c-pink-bg': 'rgba(255, 55, 95, 0.24)',
    '--c-red': '#ff6961',
    '--c-red-bg': 'rgba(255, 69, 58, 0.24)'
  }
} satisfies Pick<Preset, 'shared' | 'light' | 'dark'>
// </glass-defaults>

export const PRESETS: Preset[] = [
  {
    id: 'zen',
    name: 'Zen',
    description: 'The default: paper and ink, one quiet material, an indigo accent.',
    light: {},
    dark: {},
    shared: {}
  },
  {
    id: 'zen-ink',
    name: 'Zen ink',
    description: 'Zen with whiter paper, blacker ink and firmer lines.',
    shared: { '--hairline': '1px' },
    light: {
      ...wallpaper('#f5f3ee', '#faf8f4', '#f5f3ee', '#eeebe4', '#f2f0ea'),
      '--bg': '#fffefb',
      '--bg-solid': '#fffefb',
      '--bg-elevated': '#ffffff',
      '--glass-thick-bg': 'rgba(255, 255, 253, 0.97)',
      '--text': '#12110f',
      '--text-secondary': '#45423b',
      '--text-tertiary': '#69645a',
      '--border': 'rgba(40, 34, 22, 0.22)',
      '--border-strong': 'rgba(40, 34, 22, 0.5)',
      '--glass-border': 'rgba(40, 34, 22, 0.16)',
      '--text-menu-active': '#12110f',
      ...accent('#273763', '39, 55, 99', '#ffffff', 0.13, 0.9, 0.26)
    },
    dark: {
      ...wallpaper('#0f0e0d', '#141312', '#0f0e0d', '#0b0a0a', '#0e0d0c'),
      '--bg': '#151413',
      '--bg-solid': '#151413',
      '--bg-elevated': '#211f1d',
      '--glass-thick-bg': 'rgba(33, 31, 29, 0.97)',
      '--text': '#f6f2ea',
      '--text-secondary': '#c9c3b8',
      '--text-tertiary': '#9d978c',
      '--border': 'rgba(240, 230, 210, 0.2)',
      '--border-strong': 'rgba(240, 230, 210, 0.42)',
      '--glass-border': 'rgba(240, 230, 210, 0.16)',
      '--text-menu-active': '#f6f2ea',
      ...accent('#bcc8ea', '188, 200, 234', '#101218', 0.18, 0.9, 0.32)
    }
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'Frosted panels floating over a colour wallpaper, with a blue accent.',
    shared: { ...GLASS.shared },
    light: { ...GLASS.light },
    dark: { ...GLASS.dark }
  },
  {
    id: 'clear-glass',
    name: 'Clear glass',
    description: 'More transparent panels with a stronger blur.',
    shared: { ...GLASS.shared, '--glass-blur': '40px', '--glass-thick-blur': '64px', '--glass-saturate': '200%' },
    light: {
      ...GLASS.light,
      '--wall-intensity': '1',
      '--bg': 'rgba(255, 255, 255, 0.38)',
      '--bg-sidebar': 'rgba(255, 255, 255, 0.18)',
      '--bg-elevated': 'rgba(250, 250, 252, 0.6)',
      '--glass-bg': 'rgba(255, 255, 255, 0.3)',
      '--glass-thick-bg': 'rgba(248, 248, 252, 0.58)',
      '--glass-border': 'rgba(255, 255, 255, 0.55)',
      '--text-tertiary': 'rgba(60, 60, 67, 0.82)'
    },
    dark: {
      ...GLASS.dark,
      '--wall-intensity': '0.9',
      '--bg': 'rgba(28, 28, 32, 0.36)',
      '--bg-sidebar': 'rgba(30, 30, 36, 0.2)',
      '--bg-elevated': 'rgba(44, 44, 50, 0.58)',
      '--glass-bg': 'rgba(40, 40, 46, 0.28)',
      '--glass-thick-bg': 'rgba(38, 38, 44, 0.56)',
      '--glass-border': 'rgba(255, 255, 255, 0.16)',
      '--text-tertiary': 'rgba(235, 235, 245, 0.68)'
    }
  },
  {
    id: 'solid',
    name: 'Solid',
    description: 'Opaque surfaces and no blur, for speed and legibility.',
    shared: { ...GLASS.shared, '--glass-blur': '0px', '--glass-thick-blur': '0px', '--glass-saturate': '100%' },
    light: {
      ...GLASS.light,
      ...wallpaper('#f2f2f7', '#f2f2f7', '#f2f2f7', '#f2f2f7', '#f2f2f7'),
      '--wall-intensity': '0',
      '--bg': '#ffffff',
      '--bg-sidebar': '#f2f2f7',
      '--bg-elevated': '#ffffff',
      '--glass-bg': '#ffffff',
      '--glass-thick-bg': '#ffffff',
      '--glass-border': 'rgba(60, 60, 67, 0.16)',
      '--glass-highlight': 'rgba(255, 255, 255, 0)'
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#000000', '#000000', '#000000', '#000000', '#000000'),
      '--wall-intensity': '0',
      '--bg': '#1c1c1e',
      '--bg-sidebar': '#141416',
      '--bg-elevated': '#2c2c2e',
      '--glass-bg': '#1c1c1e',
      '--glass-thick-bg': '#2c2c2e',
      '--glass-border': 'rgba(255, 255, 255, 0.1)',
      '--glass-highlight': 'rgba(255, 255, 255, 0)'
    }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'A monochrome wallpaper with a gray accent.',
    shared: { ...GLASS.shared },
    light: {
      ...GLASS.light,
      ...wallpaper('#eeeef0', '#c9c9cf', '#e2e2e6', '#b4b4bc', '#d8d8de'),
      ...accent('#6e6e73', '110, 110, 115', '#ffffff', 0.16, 0.94, 0.26),
      '--text-tertiary': 'rgba(60, 60, 67, 0.82)',
      ...menuBar('#6e6e73', '#ffffff')
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#0c0c0d', '#3a3a3f', '#232326', '#4a4a50', '#2c2c30'),
      ...accent('#a1a1a6', '161, 161, 166', '#1c1c1e', 0.24, 0.7, 0.36),
      ...menuBar('#a1a1a6', '#1c1c1e')
    }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm oranges and pinks.',
    shared: { ...GLASS.shared },
    light: {
      ...GLASS.light,
      ...wallpaper('#fff3ea', '#ffb199', '#ffd08a', '#ff9ec2', '#ffc9a8'),
      ...accent('#f0532d', '240, 83, 45', '#ffffff', 0.14, 0.5, 0.22),
      '--focus-ring': '#ce4727',
      ...menuBar('#f0532d', '#ffffff')
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#140b0e', '#8f2f1b', '#8a5a12', '#7a1f4c', '#5c2a14'),
      ...accent('#ff7a59', '255, 122, 89', '#2a0f08', 0.22, 0.85, 0.34),
      '--text-tertiary': 'rgba(235, 235, 245, 0.68)',
      ...menuBar('#ff7a59', '#2a0f08')
    }
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Cool greens, blues and violets.',
    shared: { ...GLASS.shared },
    light: {
      ...GLASS.light,
      ...wallpaper('#ecf7f4', '#9be8d0', '#a8c8ff', '#c9b8ff', '#b8f5c4'),
      ...accent('#00917c', '0, 145, 124', '#ffffff', 0.14, 0.5, 0.22),
      '--focus-ring': '#008875',
      ...menuBar('#00917c', '#ffffff')
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#06110f', '#0f6b5c', '#1b3f8f', '#4a2a8f', '#1c6b32'),
      ...accent('#2fd6b8', '47, 214, 184', '#04221d', 0.22, 0.65, 0.32),
      '--text-tertiary': 'rgba(235, 235, 245, 0.66)',
      ...menuBar('#2fd6b8', '#04221d')
    }
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Smaller text and tighter spacing.',
    shared: {
      ...GLASS.shared,
      '--font-scale': '0.92',
      '--leading-body': '1.45',
      '--sidebar-width': '232px',
      '--topbar-height': '40px',
      '--tabbar-height': '34px',
      '--page-padding-x': '48px',
      '--panel-gap': '6px',
      '--control-height': '26px',
      '--row-height': '28px',
      '--table-row-height': '30px',
      '--indent': '22px'
    },
    light: { ...GLASS.light },
    dark: { ...GLASS.dark }
  },
  {
    id: 'high-contrast',
    name: 'High contrast',
    description: 'Stronger text, lines and surfaces.',
    shared: { ...GLASS.shared, '--hairline': '1px' },
    light: {
      ...GLASS.light,
      '--wall-intensity': '0.3',
      '--bg': 'rgba(255, 255, 255, 0.94)',
      '--bg-sidebar': 'rgba(255, 255, 255, 0.86)',
      '--bg-elevated': '#ffffff',
      '--glass-bg': 'rgba(255, 255, 255, 0.92)',
      '--glass-thick-bg': '#ffffff',
      '--glass-border': 'rgba(0, 0, 0, 0.4)',
      '--text': '#000000',
      '--text-secondary': 'rgba(0, 0, 0, 0.78)',
      '--text-tertiary': 'rgba(0, 0, 0, 0.56)',
      '--border': 'rgba(0, 0, 0, 0.4)',
      '--border-strong': 'rgba(0, 0, 0, 0.7)',
      ...accent('#0040dd', '0, 64, 221', '#ffffff', 0.2, 0.9, 0.3),
      ...menuBar('#0040dd', '#ffffff')
    },
    dark: {
      ...GLASS.dark,
      '--wall-intensity': '0.25',
      '--bg': 'rgba(0, 0, 0, 0.9)',
      '--bg-sidebar': 'rgba(0, 0, 0, 0.8)',
      '--bg-elevated': '#1c1c1e',
      '--glass-bg': 'rgba(0, 0, 0, 0.88)',
      '--glass-thick-bg': '#1c1c1e',
      '--glass-border': 'rgba(255, 255, 255, 0.5)',
      '--text': '#ffffff',
      '--text-secondary': 'rgba(255, 255, 255, 0.82)',
      '--text-tertiary': 'rgba(255, 255, 255, 0.6)',
      '--border': 'rgba(255, 255, 255, 0.45)',
      '--border-strong': 'rgba(255, 255, 255, 0.75)',
      ...accent('#409cff', '64, 156, 255', '#000000', 0.3, 0.95, 0.45),
      ...menuBar('#409cff', '#000000')
    }
  },

  // ---- looks with a window style of their own (skins.ts) ----
  {
    id: 'frutiger-aero',
    name: 'Frutiger Aero',
    description: 'Glossy glass over a sky of bokeh, gel tabs and buttons, Windows 7 caption buttons.',
    skin: 'aero',
    shared: {
      ...GLASS.shared,
      ...fonts("'Segoe UI', Frutiger, 'Frutiger Linotype', 'Myriad Pro', Tahoma, sans-serif"),
      '--font-mono': "Consolas, 'Lucida Console', monospace",
      '--weight-title': '300',
      '--weight-heading': '400',
      '--tracking-title': '0em',
      '--tracking-ui': '0em',
      ...corners(3, 5, 8, 10, 14),
      '--glass-blur': '24px',
      '--glass-saturate': '160%'
    },
    light: {
      ...GLASS.light,
      ...wallpaper('#bfe9ff', '#5fc6f5', '#e6fbff', '#79d35a', '#2fb4c8'),
      '--wall-intensity': '1',
      '--bg': 'rgba(255, 255, 255, 0.72)',
      '--bg-sidebar': 'rgba(255, 255, 255, 0.4)',
      '--glass-bg': 'rgba(255, 255, 255, 0.45)',
      '--glass-thick-bg': 'rgba(245, 252, 255, 0.86)',
      '--glass-border': 'rgba(255, 255, 255, 0.85)',
      '--text': '#102a43',
      '--text-secondary': 'rgba(16, 42, 67, 0.76)',
      '--text-tertiary': 'rgba(16, 42, 67, 0.68)',
      '--success': '#2e9e3a',
      ...accent('#0a84d6', '10, 132, 214', '#ffffff', 0.16, 1, 0.24)
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#03122a', '#0a5ca8', '#0d2f66', '#1c7a3c', '#0a7a99'),
      '--wall-intensity': '0.95',
      '--bg': 'rgba(10, 22, 40, 0.68)',
      '--bg-sidebar': 'rgba(10, 25, 45, 0.4)',
      '--glass-bg': 'rgba(12, 28, 50, 0.45)',
      '--glass-thick-bg': 'rgba(12, 26, 46, 0.86)',
      '--glass-border': 'rgba(150, 215, 255, 0.3)',
      ...accent('#3cb4ff', '60, 180, 255', '#00182c', 0.22, 0.6, 0.34)
    }
  },
  {
    id: 'windows-98',
    name: 'Windows 98',
    description: 'Grey bevelled windows on a teal desktop, navy title bars, tabs as taskbar buttons.',
    skin: 'win98',
    shared: {
      ...GLASS.shared,
      ...fonts(
        "Tahoma, 'Microsoft Sans Serif', 'MS Sans Serif', Geneva, sans-serif",
        "Tahoma, 'Microsoft Sans Serif', 'MS Sans Serif', Geneva, sans-serif",
        "'Times New Roman', Times, serif",
        "'Courier New', 'Lucida Console', monospace"
      ),
      ...RETRO_TYPE,
      '--weight-medium': '400',
      '--weight-semibold': '700',
      '--weight-title': '700',
      '--weight-heading': '700',
      '--leading-ui': '1.25',
      ...corners(0, 0, 0, 0, 0),
      '--radius-pill': '0px',
      '--hairline': '1px',
      ...NO_BLUR,
      '--panel-gap': '6px',
      '--tabbar-height': '30px',
      '--topbar-height': '36px',
      '--control-height': '24px',
      '--row-height': '22px',
      '--table-row-height': '26px',
      '--chart-bar-radius': '0px',
      '--duration-fast': '60ms',
      '--duration': '100ms',
      '--ease': 'linear'
    },
    light: {
      ...GLASS.light,
      ...wallpaper('#008080', '#008080', '#008080', '#008080', '#008080'),
      '--wall-intensity': '0',
      '--bg': '#ffffff',
      '--bg-solid': '#ffffff',
      '--bg-sidebar': '#c0c0c0',
      '--bg-elevated': '#ffffff',
      '--glass-bg': '#c0c0c0',
      '--glass-thick-bg': '#c0c0c0',
      ...NO_EDGE,
      '--bg-hover': 'rgba(0, 0, 128, 0.08)',
      '--bg-active': 'rgba(0, 0, 128, 0.16)',
      ...menuBar('#000080', '#ffffff'),
      '--bg-menu-danger': '#000080',
      '--fill-1': 'rgba(0, 0, 0, 0.16)',
      '--fill-2': 'rgba(0, 0, 0, 0.12)',
      '--fill-3': 'rgba(0, 0, 0, 0.08)',
      '--fill-4': 'rgba(0, 0, 0, 0.05)',
      '--bg-code': 'rgba(0, 0, 0, 0.06)',
      '--scrim': 'rgba(0, 0, 0, 0)',
      '--text': '#000000',
      '--text-secondary': '#404040',
      '--text-tertiary': '#808080',
      '--text-code': '#800000',
      '--border': '#808080',
      '--border-strong': '#000000',
      ...accent('#000080', '0, 0, 128', '#ffffff', 0.12, 0.6, 0.3),
      '--danger': '#c00000',
      '--success': '#008000',
      '--shadow-panel': '0 0 0 0 rgba(0, 0, 0, 0)',
      '--shadow-card': bevel('#0a0a0a', '#ffffff', '#808080', '#dfdfdf'),
      '--shadow-popover': bevel('#0a0a0a', '#dfdfdf', '#808080', '#ffffff'),
      '--shadow-control': bevel('#0a0a0a', '#ffffff', '#808080', '#dfdfdf')
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#003c3c', '#003c3c', '#003c3c', '#003c3c', '#003c3c'),
      '--wall-intensity': '0',
      '--bg': '#141414',
      '--bg-solid': '#141414',
      '--bg-sidebar': '#3c3c3c',
      '--bg-elevated': '#202020',
      '--glass-bg': '#3c3c3c',
      '--glass-thick-bg': '#3c3c3c',
      ...NO_EDGE,
      '--bg-hover': 'rgba(255, 255, 255, 0.08)',
      '--bg-active': 'rgba(255, 255, 255, 0.14)',
      ...menuBar('#0a5ca0', '#ffffff'),
      '--bg-menu-danger': '#0a5ca0',
      '--fill-1': 'rgba(255, 255, 255, 0.16)',
      '--fill-2': 'rgba(255, 255, 255, 0.12)',
      '--fill-3': 'rgba(255, 255, 255, 0.08)',
      '--fill-4': 'rgba(255, 255, 255, 0.05)',
      '--scrim': 'rgba(0, 0, 0, 0)',
      '--text': '#ffffff',
      '--text-secondary': '#c0c0c0',
      '--text-tertiary': '#a6a6a6',
      '--text-code': '#ff9090',
      '--border': '#6e6e6e',
      '--border-strong': '#c0c0c0',
      ...accent('#1084d0', '16, 132, 208', '#ffffff', 0.2, 0.7, 0.4),
      '--focus-ring': '#218dd3',
      '--shadow-panel': '0 0 0 0 rgba(0, 0, 0, 0)',
      '--shadow-card': bevel('#000000', '#7a7a7a', '#1e1e1e', '#555555'),
      '--shadow-popover': bevel('#000000', '#555555', '#1e1e1e', '#7a7a7a'),
      '--shadow-control': bevel('#000000', '#7a7a7a', '#1e1e1e', '#555555')
    }
  },
  {
    id: 'windows-xp',
    name: 'Windows XP',
    description: 'Luna: a blue title bar, the beige window face and Explorer’s task pane on Bliss. Royale Noir at night.',
    skin: 'luna',
    shared: {
      ...GLASS.shared,
      ...fonts(
        "Tahoma, 'Segoe UI', Verdana, sans-serif",
        "'Trebuchet MS', Tahoma, sans-serif",
        "'Times New Roman', Georgia, serif",
        "'Lucida Console', 'Courier New', monospace"
      ),
      ...RETRO_TYPE,
      '--weight-medium': '400',
      '--weight-title': '700',
      '--weight-heading': '700',
      ...corners(2, 3, 3, 6, 8),
      ...NO_BLUR,
      '--tabbar-height': '32px'
    },
    light: {
      ...GLASS.light,
      ...wallpaper('#4a8ad8', '#2a66cc', '#a9d0ff', '#4e9e2a', '#5aa83a'),
      '--wall-intensity': '1',
      '--bg': '#ffffff',
      '--bg-solid': '#ffffff',
      '--bg-sidebar': '#6f8fdf',
      '--bg-elevated': '#ffffff',
      '--glass-bg': '#ece9d8',
      '--glass-thick-bg': '#ffffff',
      ...NO_EDGE,
      '--scrim': 'rgba(0, 0, 0, 0.15)',
      '--text': '#000000',
      '--text-secondary': '#444444',
      '--text-tertiary': '#757575',
      '--border': 'rgba(0, 0, 0, 0.16)',
      ...accent('#316ac5', '49, 106, 197', '#ffffff', 0.16, 0.72, 0.3),
      ...menuBar('#316ac5', '#ffffff')
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#0a1a33', '#0c2a5c', '#1d3f7a', '#1d4d12', '#2a5e1a'),
      '--wall-intensity': '0.9',
      '--bg': '#1a1a1a',
      '--bg-solid': '#1a1a1a',
      '--bg-sidebar': '#222222',
      '--bg-elevated': '#262626',
      '--glass-bg': '#2a2a2a',
      '--glass-thick-bg': '#202020',
      ...NO_EDGE,
      ...accent('#4c9be8', '76, 155, 232', '#ffffff', 0.2, 0.68, 0.36),
      ...menuBar('#2f6fc0', '#ffffff')
    }
  },
  {
    id: 'aqua',
    name: 'Aqua',
    description: 'Mac OS X: pinstripes, gel tabs and buttons, a pulsing default button, traffic lights. Graphite at night.',
    skin: 'aqua',
    shared: {
      ...GLASS.shared,
      ...fonts(
        "'Lucida Grande', 'Lucida Sans Unicode', 'Lucida Sans', 'Helvetica Neue', Helvetica, sans-serif",
        "'Lucida Grande', 'Lucida Sans Unicode', 'Lucida Sans', 'Helvetica Neue', Helvetica, sans-serif",
        "Georgia, 'Times New Roman', serif",
        "Monaco, 'Lucida Console', monospace"
      ),
      '--text-ui': scaled(13),
      '--text-body': scaled(15),
      '--tracking-title': '0em',
      '--tracking-ui': '0em',
      '--weight-title': '700',
      '--weight-heading': '700',
      ...corners(3, 5, 6, 8, 10),
      ...NO_BLUR,
      '--hairline': '1px'
    },
    light: {
      ...GLASS.light,
      ...wallpaper('#3a6cc6', '#9cc8f6', '#2a5ab8', '#6aa3ec', '#163a8a'),
      '--wall-intensity': '1',
      '--bg': '#ffffff',
      '--bg-solid': '#ffffff',
      '--bg-sidebar': '#dfe5ee',
      '--bg-elevated': '#ffffff',
      '--glass-bg': '#ececec',
      '--glass-thick-bg': '#ffffff',
      '--glass-border': 'rgba(0, 0, 0, 0.25)',
      '--glass-highlight': 'rgba(255, 255, 255, 0)',
      '--text': '#000000',
      '--text-secondary': '#4d4d4d',
      '--text-tertiary': '#767676',
      '--border': 'rgba(0, 0, 0, 0.18)',
      ...accent('#3875d7', '56, 117, 215', '#ffffff', 0.16, 0.78, 0.3),
      ...menuBar('#3875d7', '#ffffff')
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#16171c', '#3b4a63', '#22252d', '#4b5568', '#1a1d24'),
      '--bg': '#1e1e20',
      '--bg-solid': '#1e1e20',
      '--bg-sidebar': '#24292f',
      '--bg-elevated': '#2a2a2d',
      '--glass-bg': '#2a2a2c',
      '--glass-thick-bg': '#28282c',
      '--glass-highlight': 'rgba(255, 255, 255, 0)',
      ...accent('#5a9cf8', '90, 156, 248', '#ffffff', 0.2, 0.66, 0.36),
      ...menuBar('#3a74d6', '#ffffff')
    }
  },
  {
    id: 'mac-os-9',
    name: 'Mac OS 9',
    description: 'Platinum: ruled title bars, bevelled boxes for window buttons, a dithered periwinkle desktop.',
    skin: 'platinum',
    shared: {
      ...GLASS.shared,
      ...fonts(
        "Geneva, Charcoal, 'Lucida Grande', Verdana, sans-serif",
        "Charcoal, Chicago, 'Trebuchet MS', Verdana, sans-serif",
        "'New York', Georgia, 'Times New Roman', serif",
        "Monaco, 'Lucida Console', 'Courier New', monospace"
      ),
      ...RETRO_TYPE,
      '--weight-medium': '400',
      '--weight-title': '700',
      '--weight-heading': '700',
      ...corners(0, 0, 0, 0, 0),
      '--hairline': '1px',
      ...NO_BLUR,
      '--tabbar-height': '30px',
      '--chart-bar-radius': '0px'
    },
    light: {
      ...GLASS.light,
      ...wallpaper('#666699', '#7777aa', '#5c5c94', '#6a6aa6', '#60609a'),
      '--wall-intensity': '1',
      '--bg': '#ffffff',
      '--bg-solid': '#ffffff',
      '--bg-sidebar': '#dddddd',
      '--bg-elevated': '#ffffff',
      '--glass-bg': '#dddddd',
      '--glass-thick-bg': '#dddddd',
      ...NO_EDGE,
      '--scrim': 'rgba(0, 0, 0, 0)',
      '--text': '#000000',
      '--text-secondary': '#3d3d3d',
      '--text-tertiary': '#606060',
      '--border': 'rgba(0, 0, 0, 0.25)',
      '--border-strong': '#000000',
      ...accent('#5555aa', '85, 85, 170', '#ffffff', 0.16, 0.76, 0.3),
      ...menuBar('#5555aa', '#ffffff')
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#222238', '#2c2c4a', '#1c1c30', '#30304e', '#24243c'),
      '--wall-intensity': '1',
      '--bg': '#1c1c1c',
      '--bg-solid': '#1c1c1c',
      '--bg-sidebar': '#3a3a3a',
      '--bg-elevated': '#262626',
      '--glass-bg': '#3a3a3a',
      '--glass-thick-bg': '#3a3a3a',
      ...NO_EDGE,
      '--scrim': 'rgba(0, 0, 0, 0)',
      '--text': '#f0f0f0',
      '--text-secondary': '#c4c4c4',
      '--text-tertiary': '#a3a3a3',
      '--border': 'rgba(255, 255, 255, 0.2)',
      ...accent('#8a8ae0', '138, 138, 224', '#000000', 0.2, 0.84, 0.36),
      ...menuBar('#6a6ac0', '#ffffff')
    }
  },
  {
    id: 'full-glass',
    name: 'Full glass',
    description: 'Clear lenses with bright rims over a vivid wallpaper; tabs, toolbars and buttons float as capsules.',
    skin: 'liquid',
    shared: {
      ...GLASS.shared,
      '--glass-blur': '48px',
      '--glass-thick-blur': '64px',
      '--glass-saturate': '220%',
      ...corners(8, 12, 16, 26, 34),
      '--hairline': '1px',
      '--panel-gap': '12px'
    },
    light: {
      ...GLASS.light,
      ...wallpaper('#d6e2ff', '#ff86d4', '#78b0ff', '#ffcf6a', '#62ecc8'),
      '--wall-intensity': '1',
      '--bg': 'rgba(255, 255, 255, 0.5)',
      '--bg-sidebar': 'rgba(255, 255, 255, 0.16)',
      '--bg-elevated': 'rgba(255, 255, 255, 0.6)',
      '--glass-bg': 'rgba(255, 255, 255, 0.22)',
      '--glass-thick-bg': 'rgba(255, 255, 255, 0.5)',
      '--glass-border': 'rgba(255, 255, 255, 0.7)'
    },
    dark: {
      ...GLASS.dark,
      ...wallpaper('#06060f', '#5a1a8a', '#123c9a', '#8a2a4a', '#0f6a6a'),
      '--wall-intensity': '1',
      '--bg': 'rgba(18, 18, 26, 0.5)',
      '--bg-sidebar': 'rgba(20, 20, 30, 0.2)',
      '--bg-elevated': 'rgba(40, 40, 52, 0.6)',
      '--glass-bg': 'rgba(30, 30, 40, 0.25)',
      '--glass-thick-bg': 'rgba(28, 28, 38, 0.55)',
      '--glass-border': 'rgba(255, 255, 255, 0.2)'
    }
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'A phosphor screen: monospace, inverse video and scan lines. Amber in the light theme, green in the dark.',
    skin: 'terminal',
    shared: {
      ...GLASS.shared,
      ...fonts(
        "'Cascadia Mono', 'Cascadia Code', Consolas, 'Lucida Console', 'Courier New', monospace",
        "'Cascadia Mono', 'Cascadia Code', Consolas, 'Lucida Console', 'Courier New', monospace",
        "'Cascadia Mono', 'Cascadia Code', Consolas, 'Lucida Console', 'Courier New', monospace",
        "'Cascadia Mono', 'Cascadia Code', Consolas, 'Lucida Console', 'Courier New', monospace"
      ),
      '--weight-medium': '400',
      '--weight-semibold': '700',
      '--weight-title': '700',
      '--weight-heading': '700',
      '--text-body': scaled(15),
      '--text-title': scaled(28),
      '--text-h1': scaled(24),
      '--text-h2': scaled(20),
      '--text-h3': scaled(17),
      '--text-emoji-hero': scaled(48),
      '--leading-body': '1.5',
      '--tracking-title': '0em',
      '--tracking-ui': '0em',
      ...corners(0, 0, 0, 0, 0),
      '--radius-pill': '0px',
      '--hairline': '1px',
      ...NO_BLUR,
      '--chart-bar-radius': '0px',
      '--ease': 'linear'
    },
    // Both themes are screens: the light one starts from the dark Glass values (tags, fills).
    light: { ...GLASS.dark, ...phosphor('#ffb000', '255, 176, 0', '#120b00', '#c88a00', '#98782f', '#ffd270', '#0d0800', '#1a1000') },
    dark: { ...GLASS.dark, ...phosphor('#33ff66', '51, 255, 102', '#001a07', '#22b84a', '#338f4b', '#a0ffb8', '#020a04', '#06180a') }
  }
]

/** By id. Has no prototype, so inherited names such as `constructor` are not presets. */
export const PRESET_MAP: Record<string, Preset> = Object.assign(
  Object.create(null),
  Object.fromEntries(PRESETS.map((preset) => [preset.id, preset]))
)
