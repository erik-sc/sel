import { memo } from 'react'
import { SHAPE_BOX, shapeOf } from './shape'

const CENTRE = SHAPE_BOX / 2

/**
 * A page or database icon. Takes the stored icon value and draws its shape one em wide,
 * so it sits wherever a character would.
 */
export const ShapeIcon = memo(function ShapeIcon({ icon }: { icon: string }) {
  return (
    <svg className="ui-shape" viewBox={`0 0 ${SHAPE_BOX} ${SHAPE_BOX}`} width="1em" height="1em" aria-hidden="true">
      {shapeOf(icon).layers.map((layer, index) => (
        <path
          key={index}
          d={layer.d}
          fill={`var(--c-${layer.colour})`}
          fillOpacity={layer.opacity}
          fillRule={layer.evenOdd ? 'evenodd' : undefined}
          transform={layer.rotate ? `rotate(${layer.rotate} ${CENTRE} ${CENTRE})` : undefined}
        />
      ))}
    </svg>
  )
})
