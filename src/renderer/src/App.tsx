import { useEffect } from 'react'
import { bootMark } from '@/boot'
import { RootBoundary } from '@/failures/RootBoundary'
import { Shell } from '@/shell/Shell'
import { initTabs, initialPageId } from '@/store/tabs'
import { initTree } from '@/store/tree'

export function App() {
  useEffect(() => {
    bootMark('mounted')
    // Both are idempotent: main.tsx already started them, before the first render.
    void initTree()
    void initTabs(initialPageId())
  }, [])

  return (
    <RootBoundary>
      <Shell />
    </RootBoundary>
  )
}

export default App
