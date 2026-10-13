import { memo } from 'react'
import { LINE_ICON_BOX, lineIconPath } from './lineIcons'
import { SHAPE_BOX, isShapeIcon, shapeOf } from './shape'

const CENTRE = SHAPE_BOX / 2

/**
 * A page or database icon, from its stored value: a generated shape (`shape:<seed>`), one of
 * sel's own line icons (`icon:<name>`), or an emoji. The drawn ones are one em wide, so all
 * three sit wherever a character would.
 */
export const IconGlyph = memo(function IconGlyph({ icon }: { icon: string }) {
  if (isShapeIcon(icon)) {
    return (
      <svg className="ui-glyph" viewBox={`0 0 ${SHAPE_BOX} ${SHAPE_BOX}`} width="1em" height="1em" aria-hidden="true">
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
  }
  const line = lineIconPath(icon)
  if (line) {
    return (
      <svg className="ui-glyph is-line" viewBox={`0 0 ${LINE_ICON_BOX} ${LINE_ICON_BOX}`} width="1em" height="1em" aria-hidden="true">
        <path d={line} />
      </svg>
    )
  }
  return <>{icon}</>
})
