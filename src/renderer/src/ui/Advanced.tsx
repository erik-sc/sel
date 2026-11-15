// What most people never change, at the end of a section of Settings: closed until asked for,
// so that a section opens on the few things that matter. Nothing in it is hidden for good.
import type { JSX, ReactNode } from 'react'
import './advanced.css'

export interface AdvancedProps {
  /** The word on the disclosure. */
  label?: string
  /** Open from the start: when something in it needs attention. */
  open?: boolean
  children: ReactNode
}

export function Advanced({ label = 'Advanced', open = false, children }: AdvancedProps): JSX.Element {
  return (
    <details className="ui-advanced" open={open || undefined}>
      <summary>{label}</summary>
      {children}
    </details>
  )
}

/** A group of rows inside `Advanced` (or anywhere in Settings), with its title. */
export function SettingsGroup({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section className="ap-group">
      <div className="ap-group-head">
        <h3 className="ap-group-title">{title}</h3>
      </div>
      <div className="ap-list">{children}</div>
      {note ? <p className="ap-note">{note}</p> : null}
    </section>
  )
}
