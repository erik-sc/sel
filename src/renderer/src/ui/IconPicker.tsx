import { useState } from 'react'
import { IconGlyph } from './IconGlyph'
import { LazyEmojiPicker, preloadEmojiPicker } from './LazyEmojiPicker'
import { LINE_ICON_NAMES, lineIconValue } from './lineIcons'
import { isShapeIcon, newShapeIcon } from './shape'

/** How many shapes are offered at a time. */
const OFFERED = 30

const offer = (): string[] => Array.from({ length: OFFERED }, () => newShapeIcon())

const KINDS = ['shapes', 'icons', 'emoji'] as const
type Kind = (typeof KINDS)[number]
const KIND_LABELS: Record<Kind, string> = { shapes: 'Shapes', icons: 'Icons', emoji: 'Emoji' }

function kindOf(icon: string | undefined): Kind {
  if (!icon || isShapeIcon(icon)) return 'shapes'
  return icon.startsWith('icon:') ? 'icons' : 'emoji'
}

export interface IconPickerProps {
  /** The icon the page has now; the picker opens on its kind. */
  current?: string
  /** The stored value of the chosen icon, or null to remove the icon. */
  onPick: (icon: string | null) => void
}

/**
 * Chooses a page or database icon: a freshly generated shape ("Shuffle" draws another set),
 * one of sel's own line icons, or an emoji.
 */
export function IconPicker({ current, onPick }: IconPickerProps) {
  const [kind, setKind] = useState<Kind>(() => kindOf(current))
  const [shapes, setShapes] = useState(offer)

  return (
    <div className="ui-icon-picker">
      <div className="ui-icon-picker-bar">
        <div className="ui-icon-picker-kinds" role="tablist" aria-label="Kind of icon">
          {KINDS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={item === kind}
              className={item === kind ? 'ui-icon-picker-kind is-selected' : 'ui-icon-picker-kind'}
              onPointerEnter={item === 'emoji' ? preloadEmojiPicker : undefined}
              onFocus={item === 'emoji' ? preloadEmojiPicker : undefined}
              onClick={() => setKind(item)}
            >
              {KIND_LABELS[item]}
            </button>
          ))}
        </div>
        {kind === 'shapes' && (
          <button type="button" className="ui-button is-ghost" onClick={() => setShapes(offer())}>
            Shuffle
          </button>
        )}
        <button type="button" className="ui-button is-ghost" onClick={() => onPick(null)}>
          Remove
        </button>
      </div>
      {kind === 'emoji' ? (
        <LazyEmojiPicker onPick={onPick} removable={false} />
      ) : (
        <div className="ui-icon-picker-grid" role="tabpanel">
          {kind === 'shapes'
            ? shapes.map((icon, index) => (
                <button key={icon} type="button" className="ui-icon-picker-cell" aria-label={`Shape ${index + 1}`} onClick={() => onPick(icon)}>
                  <IconGlyph icon={icon} />
                </button>
              ))
            : LINE_ICON_NAMES.map((name) => {
                const icon = lineIconValue(name)
                return (
                  <button
                    key={name}
                    type="button"
                    className={icon === current ? 'ui-icon-picker-cell is-current' : 'ui-icon-picker-cell'}
                    title={name}
                    aria-label={name}
                    onClick={() => onPick(icon)}
                  >
                    <IconGlyph icon={icon} />
                  </button>
                )
              })}
        </div>
      )}
    </div>
  )
}
