// A line (or block) to copy, as Settings → MCP shows commands and addresses.
import { useState } from 'react'
import type { JSX } from 'react'
import { IconButton } from '@/ui/Button'
import { Check, Copy } from '@/ui/icons'
import { notifyError } from '@/ui/toast'

export function Snippet({ text, label, block = false }: { text: string; label: string; block?: boolean }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className={block ? 'mcp-snippet is-block' : 'mcp-snippet'}>
      {block ? <pre>{text}</pre> : <code>{text}</code>}
      <IconButton
        label={copied ? 'Copied' : label}
        size="small"
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            },
            (error: unknown) => notifyError('Could not copy.', error)
          )
        }}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </div>
  )
}
