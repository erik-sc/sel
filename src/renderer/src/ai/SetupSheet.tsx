// The one place that explains what the AI features need: the Claude Code program on this
// computer, signed in with the user's own account. Every AI entry point leads here when the
// program is missing; "How to sign in" leads here when it is there but not signed in.
import { useState } from 'react'
import type { JSX } from 'react'
import type { AiStatus } from '@shared/ai'
import { Button, IconButton } from '@/ui/Button'
import { Modal } from '@/ui/Modal'
import { Check, Close, Copy } from '@/ui/icons'
import { notifyError, toast } from '@/ui/toast'
import { closeAiSetup, refreshAiStatus, useAiGate } from './gate'
import { INSTALL_COMMAND, unavailableText } from './labels'
import './ai.css'

function Command({ text }: { text: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="ai-command">
      <code>{text}</code>
      <IconButton
        label={copied ? 'Copied' : 'Copy command'}
        size="small"
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            },
            (error: unknown) => notifyError('Could not copy the command.', error)
          )
        }}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </div>
  )
}

export function SetupSheet(): JSX.Element {
  const reason = useAiGate((state) => state.setup)
  const status = useAiGate((state) => state.status)
  const [busy, setBusy] = useState<'check' | 'pick' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const signIn = reason === 'not-logged-in'

  const settle = (next: AiStatus | null): void => {
    setBusy(null)
    if (!next) return
    if (next.available && !signIn) {
      closeAiSetup()
      toast(`Claude Code ${next.version ?? ''} is ready.`.replace('  ', ' '), { kind: 'success' })
    } else if (next.available) setNote(`Claude Code ${next.version ?? ''} is installed. Sign in with the step above, then try again.`.replace('  ', ' '))
    else setNote(unavailableText(next))
  }
  const fail = (error: unknown): void => {
    setBusy(null)
    notifyError('Could not check for Claude Code.', error)
  }
  const check = (): void => {
    setBusy('check')
    setNote(null)
    refreshAiStatus(true).then(settle, fail)
  }
  const pick = (): void => {
    setBusy('pick')
    setNote(null)
    window.api.ai.pickCli().then((next) => {
      if (next) useAiGate.setState({ status: next })
      settle(next)
    }, fail)
  }

  return (
    <Modal open={reason !== null} onClose={closeAiSetup} label={signIn ? 'Sign in to Claude Code' : 'Set up AI'} className="ai-setup">
      <header className="ai-setup-head">
        <h2>{signIn ? 'Sign in to Claude Code' : 'Set up AI'}</h2>
        <IconButton label="Close" tooltip={false} onClick={closeAiSetup}>
          <Close />
        </IconButton>
      </header>
      <div className="ai-setup-body">
        <p className="ai-setup-lead">
          sel uses the Claude Code app on this computer, signed in with your own Claude account. Nothing is sent by sel itself.
        </p>
        {signIn ? (
          <ol className="ai-steps">
            <li>
              <span className="ai-step-title">Open a terminal and run Claude Code once</span>
              <Command text="claude" />
              <span className="ai-step-help">It asks you to sign in with your Claude account. When it says you are signed in, you can close it.</span>
            </li>
            <li>
              <span className="ai-step-title">Come back and try again</span>
              <span className="ai-step-help">sel uses that sign-in from then on. It never sees your password.</span>
            </li>
          </ol>
        ) : (
          <ol className="ai-steps">
            <li>
              <span className="ai-step-title">Install Claude Code</span>
              <Command text={INSTALL_COMMAND} />
              <span className="ai-step-help">Run this in a terminal. It needs Node.js.</span>
            </li>
            <li>
              <span className="ai-step-title">Sign in</span>
              <Command text="claude" />
              <span className="ai-step-help">Run it once in a terminal and sign in with your Claude account.</span>
            </li>
          </ol>
        )}
        <p className={`ai-setup-note${note ? '' : ' is-quiet'}`} role="status" aria-live="polite">
          {note ?? (signIn ? ' ' : unavailableText(status))}
        </p>
      </div>
      <footer className="ai-setup-foot">
        <Button disabled={busy !== null} onClick={pick}>
          Choose the claude program…
        </Button>
        <Button variant="primary" disabled={busy !== null} onClick={check}>
          {busy === 'check' ? 'Checking…' : 'Check again'}
        </Button>
      </footer>
    </Modal>
  )
}
