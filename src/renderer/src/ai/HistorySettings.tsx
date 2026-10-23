// Settings → AI: the conversations the balloon keeps ("Earlier"), and the log of what the AI
// applied with "Undo all of this". Part of the settings window's chunk.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { AI_HISTORY_CAPS } from '@shared/aiHistory'
import { useHome } from '@/home/store'
import { Button } from '@/ui/Button'
import { notifyError, toast } from '@/ui/toast'
import { AppliedLog } from './AppliedLog'
import { clearAppliedLog, loadAppliedLog, useAppliedLog } from './appliedStore'
import { usePersona } from '@/herman/gate'
import { balloonCopy } from './balloonCopy'
import { deleteAllConversations, loadConversations, useConversations } from './conversations'

export function HistorySettings(): JSX.Element {
  const copy = balloonCopy(
    useHome((state) => state.locale),
    usePersona().persona
  )
  const count = useConversations((state) => state.list.filter((conversation) => conversation.messages.length > 0).length)
  const entries = useAppliedLog((state) => state.entries.length)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    void loadConversations()
    void loadAppliedLog()
  }, [])

  return (
    <>
      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.conversationsLabel}</h3>
        </div>
        <div className="ap-list">
          <div className="ap-row">
            <div className="ap-row-text">
              <span className="ap-row-label">{copy.conversationsLabel}</span>
              <span className="ap-row-help">{copy.conversationsHelp(count, AI_HISTORY_CAPS.conversations)}</span>
            </div>
            <div className="ap-row-control">
              {confirming ? (
                <>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setConfirming(false)
                      deleteAllConversations().then(
                        () => toast(copy.deleted, { kind: 'success', duration: 1600 }),
                        (error: unknown) => notifyError(copy.deleteAll, error)
                      )
                    }}
                  >
                    {copy.confirmDeleteAll(count)}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {copy.cancel}
                  </Button>
                </>
              ) : (
                <Button disabled={count === 0} onClick={() => setConfirming(true)}>
                  {copy.deleteAll}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="ap-group">
        <div className="ap-group-head">
          <h3 className="ap-group-title">{copy.logLabel}</h3>
        </div>
        <p className="ap-note">{copy.logHelp}</p>
        <AppliedLog />
        {entries > 0 && (
          <p className="ap-note">
            <Button variant="ghost" onClick={() => void clearAppliedLog().catch((error: unknown) => notifyError(copy.clearLog, error))}>
              {copy.clearLog}
            </Button>
          </p>
        )}
      </section>
    </>
  )
}
