import type { ReactNode, SVGProps } from 'react'

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number }

function make(body: ReactNode, filled = false) {
  return function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {body}
      </svg>
    )
  }
}

export const Plus = make(<path d="M8 3v10M3 8h10" />)

export const Trash = make(
  <>
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.5h6.8l.6-8.5" />
    <path d="M6.7 7v3.5M9.3 7v3.5" />
  </>
)

export const Search = make(
  <>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.5 13.5" />
  </>
)

export const Settings = make(
  <>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
  </>
)

export const ChevronRight = make(<path d="M6 3.5 10.5 8 6 12.5" />)
export const ChevronDown = make(<path d="M3.5 6 8 10.5 12.5 6" />)
export const ChevronLeft = make(<path d="M10 3.5 5.5 8l4.5 4.5" />)

export const MoreHorizontal = make(
  <>
    <circle cx="3.5" cy="8" r="0.6" />
    <circle cx="8" cy="8" r="0.6" />
    <circle cx="12.5" cy="8" r="0.6" />
  </>,
  true
)

export const DragHandle = make(
  <>
    <circle cx="6" cy="3.8" r="0.5" />
    <circle cx="10" cy="3.8" r="0.5" />
    <circle cx="6" cy="8" r="0.5" />
    <circle cx="10" cy="8" r="0.5" />
    <circle cx="6" cy="12.2" r="0.5" />
    <circle cx="10" cy="12.2" r="0.5" />
  </>,
  true
)

const starPath = 'M8 2.2l1.75 3.6 3.95.55-2.87 2.77.7 3.93L8 11.2l-3.53 1.85.7-3.93L2.3 6.35l3.95-.55z'
export const Star = make(<path d={starPath} />)
export const StarFilled = make(<path d={starPath} />, true)

export const Close = make(<path d="M4 4l8 8M12 4l-8 8" />)

export const Sidebar = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.8" />
    <path d="M6 3v10" />
  </>
)

export const Page = make(
  <>
    <path d="M4 2.2h5l3 3v8.6H4z" />
    <path d="M9 2.2v3h3" />
  </>
)

export const Database = make(
  <>
    <ellipse cx="8" cy="4" rx="4.8" ry="1.9" />
    <path d="M3.2 4v8c0 1.05 2.15 1.9 4.8 1.9s4.8-.85 4.8-1.9V4M3.2 8c0 1.05 2.15 1.9 4.8 1.9s4.8-.85 4.8-1.9" />
  </>
)

/** A database with an arrow: a linked view of a database that lives elsewhere. */
export const DatabaseLinked = make(
  <>
    <ellipse cx="6.8" cy="3.9" rx="4.3" ry="1.7" />
    <path d="M2.5 3.9v7.4c0 .94 1.93 1.7 4.3 1.7M11.1 3.9v2.4M2.5 7.6c0 .94 1.93 1.7 4.3 1.7" />
    <path d="M9.5 13.5l4.2-4.2M10.5 9.3h3.2v3.2" />
  </>
)

export const Table = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6.5h12M2 9.8h12M6.5 6.5V13" />
  </>
)

export const Board = make(
  <>
    <rect x="2.2" y="3" width="3.2" height="10" rx="0.8" />
    <rect x="6.4" y="3" width="3.2" height="6.5" rx="0.8" />
    <rect x="10.6" y="3" width="3.2" height="8.5" rx="0.8" />
  </>
)

export const List = make(
  <>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
    <path d="M2.6 4h.01M2.6 8h.01M2.6 12h.01" strokeWidth={1.8} />
  </>
)

export const Gallery = make(
  <>
    <rect x="2.2" y="2.2" width="4.8" height="4.8" rx="1" />
    <rect x="9" y="2.2" width="4.8" height="4.8" rx="1" />
    <rect x="2.2" y="9" width="4.8" height="4.8" rx="1" />
    <rect x="9" y="9" width="4.8" height="4.8" rx="1" />
  </>
)

export const Calendar = make(
  <>
    <rect x="2.2" y="3.2" width="11.6" height="10.3" rx="1.5" />
    <path d="M2.2 6.6h11.6M5.3 1.9v2.4M10.7 1.9v2.4" />
  </>
)

export const Filter = make(<path d="M2.5 4.2h11M4.6 8h6.8M6.6 11.8h2.8" />)

export const Sort = make(
  <>
    <path d="M5 13V3M2.6 5.4 5 3l2.4 2.4" />
    <path d="M11 3v10M8.6 10.6 11 13l2.4-2.4" />
  </>
)

export const Check = make(<path d="M3 8.4l3.2 3.2L13 4.6" />)

export const Link = make(
  <>
    <path d="M6.9 9.1a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.8.8" />
    <path d="M9.1 6.9a2.6 2.6 0 0 0-3.7 0L3.2 9.1a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />
  </>
)

export const Image = make(
  <>
    <rect x="2.2" y="3" width="11.6" height="10" rx="1.5" />
    <circle cx="5.8" cy="6.4" r="1" />
    <path d="M2.6 11.6l3.3-3 2.4 2.1 2-1.8 3.2 2.9" />
  </>
)

export const Code = make(<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />)

export const Copy = make(
  <>
    <rect x="5.4" y="5.4" width="8" height="8" rx="1.4" />
    <path d="M10.6 5.4V3.8a1.2 1.2 0 0 0-1.2-1.2H3.8a1.2 1.2 0 0 0-1.2 1.2v5.6a1.2 1.2 0 0 0 1.2 1.2h1.6" />
  </>
)

export const ArrowUpRight = make(<path d="M4.5 11.5l7-7M5.8 4.5h5.7v5.7" />)

export const Undo = make(
  <>
    <path d="M5.4 3 2.6 5.8l2.8 2.8" />
    <path d="M2.8 5.8h6.4a3.6 3.6 0 0 1 0 7.2H6" />
  </>
)

export const Text = make(<path d="M2.5 4h11M2.5 8h11M2.5 12h7" />)
export const Hash = make(<path d="M6.2 2.5 5 13.5M11 2.5 9.8 13.5M2.8 6h10.8M2.4 10h10.8" />)

export const Tag = make(
  <>
    <path d="M2.4 2.4h5.2l6 6-5.2 5.2-6-6z" />
    <circle cx="5.3" cy="5.3" r="0.9" />
  </>
)

export const Clock = make(
  <>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M8 4.8V8l2.2 1.4" />
  </>
)

export const Mic = make(
  <>
    <rect x="6" y="2" width="4" height="7.5" rx="2" />
    <path d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8v2.2" />
  </>
)

/** The mark of the AI features: a four-pointed star with a small one beside it. */
export const Sparkle = make(<path d="M7 2.2l1.3 3.5 3.5 1.3-3.5 1.3L7 11.8 5.7 8.3 2.2 7l3.5-1.3zM12.3 10.6v3M10.8 12.1h3" />)

export const Type = make(<path d="M3 4.4V3h10v1.4M8 3v10M6.2 13h3.6" />)

// ---- charts (the view type and its kinds) ----
export const ChartColumn = make(<path d="M2.5 13.5h11M4.5 13.5V8.5M8 13.5V3.5M11.5 13.5V6.5" />)
export const ChartBar = make(<path d="M2.5 2.5v11M2.5 4.5h6M2.5 8h10.5M2.5 11.5h8" />)
export const ChartLine = make(<path d="M2.5 13.5h11M3 10.5l3.2-3.6 2.6 2.2L13 4" />)
export const ChartArea = make(
  <>
    <path d="M2.5 13.5h11" />
    <path d="M3 11.5V9.8l3.2-3.4 2.6 2.2L13 4v7.5z" />
  </>
)
export const ChartPie = make(
  <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5V8l4.2 3.5" />
  </>
)
export const ChartDonut = make(
  <>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="2.3" />
    <path d="M8 2.5v3.2M10 9.2l2.6 1.9" />
  </>
)
export const ChartNumber = make(
  <>
    <rect x="2.5" y="3.5" width="11" height="9" rx="2" />
    <path d="M6 10V6l-1 .8M8.6 6.4c.5-.6 1.9-.5 1.9.5 0 .8-1.9 1.8-1.9 3.1h2.1" />
  </>
)
