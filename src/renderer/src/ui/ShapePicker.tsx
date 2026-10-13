import { useState } from 'react'
import { ShapeIcon } from './ShapeIcon'
import { newShapeIcon } from './shape'

/** How many shapes are offered at a time. */
const OFFERED = 30

const offer = (): string[] => Array.from({ length: OFFERED }, () => newShapeIcon())

export interface ShapePickerProps {
  /** The stored icon value of the chosen shape, or null to remove the icon. */
  onPick: (icon: string | null) => void
}

/** Chooses a page or database icon from freshly generated shapes; "Shuffle" draws another set. */
export function ShapePicker({ onPick }: ShapePickerProps) {
  const [icons, setIcons] = useState(offer)

  return (
    <div className="ui-shape-picker">
      <div className="ui-shape-toolbar">
        <span className="ui-shape-heading">Shapes</span>
        <button type="button" className="ui-button is-ghost" onClick={() => setIcons(offer())}>
          Shuffle
        </button>
        <button type="button" className="ui-button is-ghost" onClick={() => onPick(null)}>
          Remove
        </button>
      </div>
      <div className="ui-shape-grid">
        {icons.map((icon, index) => (
          <button key={icon} type="button" className="ui-shape-cell" aria-label={`Shape ${index + 1}`} onClick={() => onPick(icon)}>
            <ShapeIcon icon={icon} />
          </button>
        ))}
      </div>
    </div>
  )
}
