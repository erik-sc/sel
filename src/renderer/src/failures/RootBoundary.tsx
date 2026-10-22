// The last net under a whole window (the shell, the quick add): a render error shows a way out
// instead of a blank window. Pages have their own, closer one (shell/PageHost.tsx).
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/ui/Button'
import { notifyError } from '@/ui/toast'
import { failureCopy } from './notify'

export class RootBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    notifyError(failureCopy().brokenTitle, error)
    console.error('the window failed to render', info.componentStack)
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    const copy = failureCopy()
    return (
      <div className="page-state is-root" role="alert">
        <h2>{copy.brokenTitle}</h2>
        <p>{copy.brokenText}</p>
        <div className="page-state-actions">
          <Button variant="primary" onClick={() => window.location.reload()}>
            {copy.reload}
          </Button>
        </div>
      </div>
    )
  }
}
