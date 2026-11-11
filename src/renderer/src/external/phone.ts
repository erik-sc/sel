// Where "Claude on your phone" stands, in words. Pure: no React, no DOM.
import type { RemoteStatus, TunnelStatus } from '../../../shared/mcp'

/** Where "Claude on your phone" stands, in one line, and the one thing to do about it. */
export function phoneLine(status: RemoteStatus): { text: string; error: boolean; action: 'install' | 'approve' | 'retry' | null } {
  if (!status.enabled) return { text: 'Off: Claude cannot reach sel from outside this computer.', error: false, action: null }
  if (status.error) return { text: status.error, error: true, action: 'retry' }
  const tunnel: TunnelStatus = status.tunnelStatus
  switch (tunnel.state) {
    case 'on':
      return { text: 'On. It starts with sel, by itself.', error: false, action: null }
    case 'no-tailscale':
      return {
        text: 'One thing is missing: Tailscale, the free program sel uses to be reached from outside. Install it, sign in, and try again.',
        error: true,
        action: 'install'
      }
    case 'signed-out':
      return {
        text: 'Tailscale is installed but not signed in. Open it from the notification area, sign in, and try again.',
        error: true,
        action: 'retry'
      }
    case 'needs-approval':
      return {
        text: 'Tailscale asks you to allow public access for this computer, once. Allow it there, then try again.',
        error: true,
        action: 'approve'
      }
    case 'failed':
      return { text: 'The way in from outside could not be opened.', error: true, action: 'retry' }
    default:
      // On with an address typed by hand (Advanced), or still starting.
      if (!status.running) return { text: 'Starting…', error: false, action: null }
      return status.publicUrl
        ? { text: 'On, at the address set under Advanced.', error: false, action: null }
        : { text: 'On, on this computer only. For the phone, turn it off and on again here.', error: false, action: 'retry' }
  }
}
