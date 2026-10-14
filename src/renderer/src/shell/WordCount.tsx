// The word count in the top bar: "1,240 words · 6 min read" for the page on screen, or how
// much is selected while there is a selection. Quiet and self-contained: it reads the block
// cache and the selection, and renders nothing when switched off (Settings → General) or when
// the page has no words. The counting itself is pure and lives in ./countWords.
import { memo, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { getBlock, useBlockStore } from '@/store/blocks'
import { useBlockSelection } from '@/store/selection'
import { useUi } from '@/store/ui'
import { Tooltip } from '@/ui/Tooltip'
import {
  countBlocks,
  countPage,
  countText,
  describeDetail,
  describePage,
  describeSelection,
  sameCounts,
  type TextCounts
} from './countWords'

/** At most one recount per this long while the page is being edited. */
const RECOUNT_MS = 250
/** A drag across text fires many selection changes; one count when it settles is enough. */
const SELECTION_MS = 120
/** Text selected here is not the page's own (an embedded database, the AI and meeting slots). */
const FOREIGN = '.blk-database-box, .pe-rowprops, .ai-slot, .mt-slot'

/** The counts of the text selected in the page editor, or of the blocks selected in it; null when nothing is. */
function selectionCounts(pageId: string): TextCounts | null {
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const node = selection.getRangeAt(0).commonAncestorContainer
    const element = node instanceof Element ? node : node.parentElement
    if (element?.closest('main.content .pe-page') && !element.closest(FOREIGN)) {
      const counts = countText(selection.toString())
      if (counts.words > 0) return counts
    }
  }
  const blocks = useBlockSelection.getState()
  if (blocks.pageId === pageId && blocks.ids.length > 0) return countBlocks(blocks.ids, getBlock)
  return null
}

function Readout({ pageId }: { pageId: string }): JSX.Element | null {
  const [page, setPage] = useState<TextCounts>(() => countPage(pageId, getBlock))
  const [picked, setPicked] = useState<TextCounts | null>(null)

  // The page: counted again after the cache changes, at most every RECOUNT_MS while typing.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const recount = (): void => {
      timer = null
      const next = countPage(pageId, getBlock)
      setPage((current) => (sameCounts(current, next) ? current : next))
    }
    recount()
    const off = useBlockStore.subscribe((state, previous) => {
      if (state.blocks !== previous.blocks && timer === null) timer = setTimeout(recount, RECOUNT_MS)
    })
    return () => {
      off()
      if (timer !== null) clearTimeout(timer)
    }
  }, [pageId])

  // The selection: text in the editor, or blocks selected as blocks.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const read = (): void => {
      timer = null
      const next = selectionCounts(pageId)
      setPicked((current) => (next && current && sameCounts(current, next) ? current : next))
    }
    const schedule = (): void => {
      if (timer === null) timer = setTimeout(read, SELECTION_MS)
    }
    read()
    document.addEventListener('selectionchange', schedule)
    const offBlocks = useBlockSelection.subscribe(schedule)
    // Selected blocks edited or deleted while selected.
    const offCache = useBlockStore.subscribe((state, previous) => {
      if (state.blocks !== previous.blocks && useBlockSelection.getState().ids.length > 0) schedule()
    })
    return () => {
      document.removeEventListener('selectionchange', schedule)
      offBlocks()
      offCache()
      if (timer !== null) clearTimeout(timer)
    }
  }, [pageId])

  const shown = picked ?? page
  const label = picked ? describeSelection(picked) : describePage(page)
  if (!label) return null
  return (
    <Tooltip label={describeDetail(shown)}>
      <span className={picked ? 'word-count is-selection' : 'word-count'}>{label}</span>
    </Tooltip>
  )
}

/** The readout for `pageId`, unless the user switched it off. */
export const WordCount = memo(function WordCount({ pageId }: { pageId: string }): JSX.Element | null {
  const on = useUi((state) => state.wordCount)
  return on ? <Readout key={pageId} pageId={pageId} /> : null
})
