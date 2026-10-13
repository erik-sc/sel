/** Ready-made looks, each expressed as overrides on top of the defaults in tokens.css. */

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

function wallpaper(base: string, c1: string, c2: string, c3: string, c4: string) {
  return { '--wall-base': base, '--wall-1': c1, '--wall-2': c2, '--wall-3': c3, '--wall-4': c4 }
}

export const PRESETS: Preset[] = [
  {
    id: 'glass',
    name: 'Glass',
    description: 'The default frosted look.',
    light: {},
    dark: {},
    shared: {}
  },
  {
    id: 'clear-glass',
    name: 'Clear glass',
    description: 'More transparent panels with a stronger blur.',
    shared: { '--glass-blur': '40px', '--glass-thick-blur': '64px', '--glass-saturate': '200%' },
    light: {
      '--wall-intensity': '1',
      '--bg': 'rgba(255, 255, 255, 0.38)',
      '--bg-sidebar': 'rgba(255, 255, 255, 0.18)',
      '--bg-elevated': 'rgba(250, 250, 252, 0.6)',
      '--glass-bg': 'rgba(255, 255, 255, 0.3)',
      '--glass-thick-bg': 'rgba(248, 248, 252, 0.58)',
      '--glass-border': 'rgba(255, 255, 255, 0.55)'
    },
    dark: {
      '--wall-intensity': '0.9',
      '--bg': 'rgba(28, 28, 32, 0.36)',
      '--bg-sidebar': 'rgba(30, 30, 36, 0.2)',
      '--bg-elevated': 'rgba(44, 44, 50, 0.58)',
      '--glass-bg': 'rgba(40, 40, 46, 0.28)',
      '--glass-thick-bg': 'rgba(38, 38, 44, 0.56)',
      '--glass-border': 'rgba(255, 255, 255, 0.16)'
    }
  },
  {
    id: 'solid',
    name: 'Solid',
    description: 'Opaque surfaces and no blur, for speed and legibility.',
    shared: { '--glass-blur': '0px', '--glass-thick-blur': '0px', '--glass-saturate': '100%' },
    light: {
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
    shared: {},
    light: {
      ...wallpaper('#eeeef0', '#c9c9cf', '#e2e2e6', '#b4b4bc', '#d8d8de'),
      ...accent('#6e6e73', '110, 110, 115', '#ffffff', 0.16, 0.5, 0.26)
    },
    dark: {
      ...wallpaper('#0c0c0d', '#3a3a3f', '#232326', '#4a4a50', '#2c2c30'),
      ...accent('#a1a1a6', '161, 161, 166', '#1c1c1e', 0.24, 0.6, 0.36)
    }
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm oranges and pinks.',
    shared: {},
    light: {
      ...wallpaper('#fff3ea', '#ffb199', '#ffd08a', '#ff9ec2', '#ffc9a8'),
      ...accent('#f0532d', '240, 83, 45', '#ffffff', 0.14, 0.5, 0.22)
    },
    dark: {
      ...wallpaper('#140b0e', '#8f2f1b', '#8a5a12', '#7a1f4c', '#5c2a14'),
      ...accent('#ff7a59', '255, 122, 89', '#2a0f08', 0.22, 0.6, 0.34)
    }
  },
  {
    id: 'aurora',
    name: 'Aurora',
    description: 'Cool greens, blues and violets.',
    shared: {},
    light: {
      ...wallpaper('#ecf7f4', '#9be8d0', '#a8c8ff', '#c9b8ff', '#b8f5c4'),
      ...accent('#00917c', '0, 145, 124', '#ffffff', 0.14, 0.5, 0.22)
    },
    dark: {
      ...wallpaper('#06110f', '#0f6b5c', '#1b3f8f', '#4a2a8f', '#1c6b32'),
      ...accent('#2fd6b8', '47, 214, 184', '#04221d', 0.22, 0.6, 0.32)
    }
  },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Smaller text and tighter spacing.',
    shared: {
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
    light: {},
    dark: {}
  },
  {
    id: 'high-contrast',
    name: 'High contrast',
    description: 'Stronger text, lines and surfaces.',
    shared: { '--hairline': '1px' },
    light: {
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
      ...accent('#0040dd', '0, 64, 221', '#ffffff', 0.2, 0.9, 0.3)
    },
    dark: {
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
      ...accent('#409cff', '64, 156, 255', '#000000', 0.3, 0.95, 0.45)
    }
  }
]

/** By id. Has no prototype, so inherited names such as `constructor` are not presets. */
export const PRESET_MAP: Record<string, Preset> = Object.assign(
  Object.create(null),
  Object.fromEntries(PRESETS.map((preset) => [preset.id, preset]))
)
