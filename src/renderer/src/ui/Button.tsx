import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { Tooltip } from './Tooltip'

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'ref'>

export interface IconButtonProps extends NativeProps {
  /** Accessible name; also shown as a tooltip unless `tooltip` is false. */
  label: string
  shortcut?: string
  tooltip?: boolean
  active?: boolean
  size?: 'small' | 'medium'
  ref?: Ref<HTMLButtonElement>
  children: ReactNode
}

export function IconButton({
  label,
  shortcut,
  tooltip = true,
  active,
  size = 'medium',
  className,
  children,
  ref,
  ...rest
}: IconButtonProps) {
  const classes = ['ui-icon-button', `is-${size}`]
  if (active) classes.push('is-active')
  if (className) classes.push(className)
  const button = (
    <button type="button" aria-label={label} ref={ref} className={classes.join(' ')} {...rest}>
      {children}
    </button>
  )
  return tooltip ? (
    <Tooltip label={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  )
}

export interface ButtonProps extends NativeProps {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  icon?: ReactNode
  ref?: Ref<HTMLButtonElement>
  children?: ReactNode
}

export function Button({ variant = 'default', icon, className, children, ref, ...rest }: ButtonProps) {
  const classes = ['ui-button', `is-${variant}`]
  if (className) classes.push(className)
  return (
    <button type="button" ref={ref} className={classes.join(' ')} {...rest}>
      {icon && <span className="ui-button-icon">{icon}</span>}
      {children}
    </button>
  )
}
