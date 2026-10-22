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
  }
]

/** By id. Has no prototype, so inherited names such as `constructor` are not presets. */
export const PRESET_MAP: Record<string, Preset> = Object.assign(
  Object.create(null),
  Object.fromEntries(PRESETS.map((preset) => [preset.id, preset]))
)
