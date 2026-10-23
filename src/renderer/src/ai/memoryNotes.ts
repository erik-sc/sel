// The persona's memory in the window (0.8.0 A3): each answer that finishes in the balloon is handed
// to the main process, which decides whether it is worth a small request and keeps what it picks
// out (src/main/ai/memory.ts). What was kept shows under that answer, "Remembered: …", with "Undo".
// Nothing is asked first: the memory is automatic, and Settings → AI → Memory turns it off.
// Small and always loaded with the AI feature.
import { useHome } from '@/home/store'
import { useHerman } from '@/herman/gate'
import { notifyError } from '@/ui/toast'
import { addReplyNote, onReplyDone, type BalloonReply } from './balloonGate'
import { memoryCopy } from './memoryCopy'

/** The pages a turn was about: the request's page, and the route it was asked from (a private page sends none). */
export function pagesOf(reply: Pick<BalloonReply, 'pageId' | 'route'>): string[] {
  return [...new Set([reply.pageId, reply.route].filter((id): id is string => typeof id === 'string' && id !== ''))]
}

/** Reads one finished turn; what is kept is noted under it. */
export async function rememberReply(reply: BalloonReply): Promise<void> {
  const facts = await window.api.ai.remember({
    conversationId: reply.conversationId,
    messageId: reply.messageId,
    question: reply.question,
    answer: reply.answer,
    history: reply.history,
    pageIds: pagesOf(reply)
  })
  if (!facts.length) return
  const copy = memoryCopy(useHome.getState().locale, useHerman.getState().persona)
  const at = { conversationId: reply.conversationId, messageId: reply.messageId }
  for (const fact of facts) {
    const remove = addReplyNote(
      {
        text: copy.remembered(fact.text),
        action: {
          label: copy.undo,
          run: async () => {
            try {
              await window.api.ai.memory({ op: 'remove', ids: [fact.id] })
              remove()
            } catch (error) {
              notifyError(copy.undoFailed, error)
            }
          }
        }
      },
      at
    )
  }
}

let listening = false

/** Starts listening to the balloon's answers; once per window. */
export function startMemory(): void {
  if (listening) return
  listening = true
  onReplyDone((reply) => {
    rememberReply(reply).catch((error: unknown) => console.error('ai: the memory could not read an answer', error))
  })
}
