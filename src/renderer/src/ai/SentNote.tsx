// The quiet line under an answer that says what went along with the request from Settings → AI:
// the written context, pinned pages, the context of the page's project or database, and the
// user's own MCP servers.
import type { JSX } from 'react'
import type { AiSent } from '@shared/aiContext'
import { useHome } from '@/home/store'
import { CONTEXT_COPY, sentLine } from './contextCopy'

export function SentNote({ sent }: { sent?: AiSent }): JSX.Element | null {
  const locale = useHome((state) => state.locale)
  const line = sentLine(sent, CONTEXT_COPY[locale])
  if (!line) return null
  // The titles of the pages that went along, pinned in the settings or to the page's project or database.
  const titles = [...(sent?.pages ?? []), ...(sent?.scopes ?? []).flatMap((scope) => scope.pages)]
  const title = titles.length ? titles.join(', ') : undefined
  return (
    <p className="ai-sent" title={title}>
      {line}
    </p>
  )
}
