// Icons of the sync indicator, drawn like the ones in @/ui/icons (16px grid, 1.4 stroke).
import type { ReactNode } from 'react'

function Icon({ size = 16, children, className }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

const CLOUD = 'M4.6 12.2a2.9 2.9 0 0 1-.5-5.76 4 4 0 0 1 7.73-.56 3.2 3.2 0 0 1-.43 6.32z'

/** Up to date: a cloud with a tick. */
export function SyncDone({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d={CLOUD} />
      <path d="M6.3 8.9l1.3 1.3 2.3-2.5" />
    </Icon>
  )
}

/** Working: two arrows chasing each other (the stylesheet turns them). */
export function SyncBusy({ size }: { size?: number }) {
  return (
    <Icon size={size} className="sync-spin">
      <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5" />
      <path d="M11.8 2.2v2.5H9.3M4.2 13.8v-2.5h2.5" />
    </Icon>
  )
}

/** Offline or paused: a cloud with a line through it. */
export function SyncOff({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d={CLOUD} />
      <path d="M3 2.8l10 10.6" />
    </Icon>
  )
}

/** Needs a person: a cloud with an exclamation mark. */
export function SyncAlert({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d={CLOUD} />
      <path d="M8 6.6v2.3M8 10.6v.1" />
    </Icon>
  )
}

/** Changes waiting to go up: a cloud with an arrow. */
export function SyncPending({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d={CLOUD} />
      <path d="M8 10.8V7.4M6.6 8.7 8 7.3l1.4 1.4" />
    </Icon>
  )
}
