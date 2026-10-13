import { createPortal } from 'react-dom'
import { Close } from './icons'
import { dismissToast, useToasts } from './toast'

/** Renders the notifications queued with `toast()`. Mount once, near the root. */
export function Toaster() {
  const toasts = useToasts((state) => state.toasts)
  return createPortal(
    <div className="ui-toasts" role="region" aria-label="Notifications">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`ui-toast glass-thick is-${item.kind}`}
          role={item.kind === 'error' ? 'alert' : 'status'}
        >
          <span className="ui-toast-message">{item.message}</span>
          {item.action && (
            <button
              type="button"
              className="ui-toast-action"
              onClick={() => {
                const { action } = item
                dismissToast(item.id)
                action?.run()
              }}
            >
              {item.action.label}
            </button>
          )}
          <button
            type="button"
            className="ui-toast-close"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(item.id)}
          >
            <Close size={12} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}
