// An AI answer shown as rich text: its Markdown parsed into the blocks a paste would create
// and drawn by the read-only block renderer the version history uses. Nothing here is editable
// and nothing is HTML: the text only ever becomes block props.
import { memo, useMemo } from 'react'
import type { JSX } from 'react'
import { SnapshotBlocks } from '@/versions/ReadOnlyBlocks'
import '@/editor/editor.css'
import { markdownToSnapshot } from './plan'
import './ai.css'

export const MarkdownView = memo(function MarkdownView({ markdown }: { markdown: string }): JSX.Element {
  const content = useMemo(() => markdownToSnapshot(markdown), [markdown])
  return (
    <div className="ai-md pe-root">
      <SnapshotBlocks content={content} />
    </div>
  )
})
