// A member of Herman's council, drawn: head, shoulders and what makes them themselves, in
// their own colour. The strokes draw themselves in when the face appears; while the member
// thinks a small curl turns beside them, and a member who gave no answer is drawn faint.
import type { CSSProperties, JSX } from 'react'
import { COUNCIL_PEOPLE, type CouncilMemberId } from '@shared/council'
import { FACE_THOUGHT_PATH, FACE_VIEW_BOX, faceStrokes, MEMBER_COLORS } from './faces'
import './herman.css'

export type FaceState = 'idle' | 'thinking' | 'done' | 'failed'

export interface CouncilFaceProps {
  member: CouncilMemberId
  state?: FaceState
  /** Draws the strokes in one after the other when the face appears. */
  draw?: boolean
  /** Shown as a tooltip and to assistive technology; the face is decoration otherwise. */
  label?: boolean
  className?: string
}

export function CouncilFace({ member, state = 'idle', draw = false, label = false, className }: CouncilFaceProps): JSX.Element {
  const strokes = faceStrokes(member)
  const classes = ['council-face', `is-${state}`]
  if (draw) classes.push('is-drawn')
  if (className) classes.push(className)
  const { name, role } = COUNCIL_PEOPLE[member]
  const style = { '--member-color': `var(--c-${MEMBER_COLORS[member]})` } as CSSProperties
  return (
    <svg
      className={classes.join(' ')}
      style={style}
      viewBox={FACE_VIEW_BOX}
      focusable="false"
      {...(label ? { role: 'img', 'aria-label': `${name}, ${role}` } : { 'aria-hidden': true })}
    >
      {label && <title>{`${name}, ${role}`}</title>}
      {strokes.map((d, index) => (
        <path key={index} className="council-face-line" pathLength={1} d={d} style={{ '--stroke-index': index } as CSSProperties} />
      ))}
      <path className="council-face-thought" pathLength={1} d={FACE_THOUGHT_PATH} />
    </svg>
  )
}
