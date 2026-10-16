// The few words of LaTeX documents the shell shows before any of their code is loaded (menus and
// palette commands), in English and in Brazilian Portuguese, and how the language is chosen: the
// way the archive's is (archive/copy.ts), the language set for AI answers when it is one of the
// two, else the system's. Pure. The rest of the words are in words.ts, loaded with the screen.
import { isAiLanguage } from '../../../shared/ai'

export type LatexLocale = 'en' | 'pt-BR'

export function latexLocale(aiLanguage: unknown, systemLocale: string | undefined): LatexLocale {
  if (isAiLanguage(aiLanguage)) return aiLanguage === 'pt-BR' ? 'pt-BR' : 'en'
  return typeof systemLocale === 'string' && /^pt\b/i.test(systemLocale) ? 'pt-BR' : 'en'
}

export interface LatexShellCopy {
  /** "New page ▸ LaTeX document". */
  newDocument: string
  /** In a page's menu: a LaTeX document under it. */
  addInside: string
  /** The title a new document gets. */
  untitled: string
  commandNew: string
  commandExportTex: string
  commandExportPdf: string
  keywords: readonly string[]
}

export const LATEX_SHELL_COPY: Record<LatexLocale, LatexShellCopy> = {
  en: {
    newDocument: 'LaTeX document',
    addInside: 'Add a LaTeX document inside',
    untitled: 'LaTeX document',
    commandNew: 'New LaTeX document',
    commandExportTex: 'Export this LaTeX document as .tex…',
    commandExportPdf: 'Export this LaTeX document as PDF…',
    keywords: ['latex', 'tex', 'overleaf', 'math', 'article', 'paper', 'documento', 'artigo']
  },
  'pt-BR': {
    newDocument: 'Documento LaTeX',
    addInside: 'Adicionar um documento LaTeX dentro',
    untitled: 'Documento LaTeX',
    commandNew: 'Novo documento LaTeX',
    commandExportTex: 'Exportar este documento LaTeX como .tex…',
    commandExportPdf: 'Exportar este documento LaTeX como PDF…',
    keywords: ['latex', 'tex', 'overleaf', 'math', 'matemática', 'artigo', 'document', 'paper']
  }
}
