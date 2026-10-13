import { Suspense, lazy } from 'react'
import type { EmojiPickerProps } from './EmojiPicker'

// The picker and its emoji table are only needed once somebody opens it.
const load = (): Promise<typeof import('./EmojiPicker')> => import('./EmojiPicker')
const Picker = lazy(() => load().then((module) => ({ default: module.EmojiPicker })))

/** Starts fetching the picker; call it when the pointer or the focus reaches its trigger. */
export function preloadEmojiPicker(): void {
  void load().catch(() => undefined)
}

/** Drop-in replacement for `EmojiPicker` that loads it on demand, holding its size meanwhile. */
export function LazyEmojiPicker(props: EmojiPickerProps) {
  return (
    <Suspense fallback={<div className="ui-emoji-picker" aria-busy="true" />}>
      <Picker {...props} />
    </Suspense>
  )
}
