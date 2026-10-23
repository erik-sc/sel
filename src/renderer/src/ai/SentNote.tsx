// The quiet line under an answer that says what went along with the request from Settings → AI:
// the written context, pinned pages, and the user's own MCP servers.
import type { JSX } from 'react'
import type { AiSent } from '@shared/aiContext'
import { useHome } from '@/home/store'
import { CONTEXT_COPY, sentLine } from './contextCopy'

export function SentNote({ sent }: { sent?: AiSent }): JSX.Element | null {
  const locale = useHome((state) => state.locale)
  const line = sentLine(sent, CONTEXT_COPY[locale])
  if (!line) return null
  const title = sent?.pages.length ? sent.pages.join(', ') : undefined
  return (
    <p className="ai-sent" title={title}>
      {line}
    </p>
  )
}
