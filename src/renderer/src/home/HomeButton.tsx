// The Home button at the top of the sidebar. When the home cannot open (its page is in the
// Trash, or not on this device yet) it stays in place, dimmed, and says why.
import { Home } from '@/ui/icons'
import { pageTitle } from '@/shell/actions'
import { goHome, homeHint, useHomeCopy, useHomeStatus } from './store'
import './home.css'

export function HomeButton() {
  const copy = useHomeCopy()
  const { home, status, block } = useHomeStatus()
  const hint = homeHint(status, copy)
  const blocked = status === 'trashed' || status === 'missing'
  const name = home === null ? null : home.kind === 'screen' ? copy.screens[home.route] : block ? pageTitle(block) || copy.untitled : null
  return (
    <button
      type="button"
      className="sidebar-action home-action"
      aria-disabled={blocked || undefined}
      title={hint ?? (name ? `${copy.home}: ${name}` : copy.home)}
      onClick={() => {
        if (!blocked) goHome()
      }}
    >
      <Home />
      <span>{copy.home}</span>
    </button>
  )
}
