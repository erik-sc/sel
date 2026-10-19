// Icons only the recording bar uses. Drawn like the shell's own (ui/icons.tsx: a 16 px grid,
// the current colour), kept here so that they load with the bar instead of with the app.
import type { JSX, ReactNode } from 'react'

function icon(body: ReactNode, filled = false): () => JSX.Element {
  return function Icon() {
    return (
      <svg
        width={16}
        height={16}
        viewBox="0 0 16 16"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {body}
      </svg>
    )
  }
}

export const Play = icon(<path d="M5 3.4v9.2L12.4 8z" />, true)
export const Pause = icon(<path d="M5.4 3.6v8.8M10.6 3.6v8.8" />)
export const Stop = icon(<rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.4" />, true)
