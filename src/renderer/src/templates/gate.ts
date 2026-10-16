// The always-loaded part of the template gallery: whether it is open and, when it was opened
// from a page, which one (offered as the place to put the template). The gallery itself, and
// the templates' data, are a chunk of their own (Host.tsx).
import { create } from 'zustand'
import { useHome } from '@/home/store'
import { TEMPLATES_COPY, type TemplatesCopy } from './copy'

interface TemplatesGate {
  open: boolean
  /** The page the gallery offers to put the template inside, besides the workspace root. */
  pageId: string | null
  /** Whether that page is where it goes unless the user picks the root. */
  inside: boolean
}

export const useTemplatesGate = create<TemplatesGate>(() => ({ open: false, pageId: null, inside: false }))

/**
 * Opens the gallery. With a page, it offers to put the template inside it (and does, when
 * `inside`: "Add a template inside" in a page's menu); without one, at the workspace root.
 */
export function openTemplates(options: { pageId?: string | null; inside?: boolean } = {}): void {
  useTemplatesGate.setState({ open: true, pageId: options.pageId ?? null, inside: options.inside === true && !!options.pageId })
}

export function closeTemplates(): void {
  useTemplatesGate.setState({ open: false })
}

/** The gallery's words, in the language of the home (the language set for AI answers, else the system's). */
export function templatesCopy(): TemplatesCopy {
  return TEMPLATES_COPY[useHome.getState().locale]
}

export function useTemplatesCopy(): TemplatesCopy {
  return TEMPLATES_COPY[useHome((state) => state.locale)]
}
