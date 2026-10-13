import { createContext, useContext } from 'react'
import type { EditorController } from './controller'

export interface EditorContextValue {
  ctrl: EditorController
  onOpenPage: (id: string, opts?: { newTab?: boolean }) => void
}

export const EditorContext = createContext<EditorContextValue | null>(null)

export function useEditor(): EditorContextValue {
  const value = useContext(EditorContext)
  if (!value) throw new Error('useEditor must be used inside <PageEditor>')
  return value
}
