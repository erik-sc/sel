// The words of the LaTeX screen, of its diagnostics, of the documents it prints and of equation
// blocks, in English and in Brazilian Portuguese (the language is chosen in copy.ts). Only the
// lazily loaded code imports this file; the shell's few words are in copy.ts. Pure.
import type { LatexLocale } from './copy'

export type { LatexLocale }

/** What a diagnostic is about; `args` fill its message. */
export type DiagnosticCode =
  | 'unsupported-command'
  | 'unsupported-environment'
  | 'unsupported-class'
  | 'ignored-package'
  | 'package-in-body'
  | 'images'
  | 'citations'
  | 'undefined-reference'
  | 'duplicate-label'
  | 'text-in-preamble'
  | 'text-after-end'
  | 'too-many'
  | 'missing-begin-document'
  | 'unclosed-group'
  | 'extra-close'
  | 'unclosed-environment'
  | 'extra-end'
  | 'unclosed-math'
  | 'math-error'
  | 'math-unsupported'
  | 'misplaced-alignment'
  | 'missing-dollar'
  | 'parameter-outside-macro'
  | 'missing-item'
  | 'lonely-item'
  | 'missing-argument'
  | 'macro-loop'

type Messages = Record<DiagnosticCode, (a: string, b: string, c: string) => string>

const MESSAGES: Record<LatexLocale, Messages> = {
  en: {
    'unsupported-command': (a) => `${a} is not supported by the preview; it is marked where it appears.`,
    'unsupported-environment': (a) => `The ${a} environment is not supported by the preview; its content is shown as it is.`,
    'unsupported-class': (a) => `The ${a} class is shown as an article.`,
    'ignored-package': (a) => `The ${a} package is ignored by the preview.`,
    'package-in-body': () => '\\usepackage belongs in the preamble, before \\begin{document}.',
    images: () => 'Images are not shown in the preview.',
    citations: () => 'Citations and bibliographies are not supported; the key is shown instead.',
    'undefined-reference': (a) => `Reference "${a}" is not defined by any \\label.`,
    'duplicate-label': (a) => `Label "${a}" is defined more than once.`,
    'text-in-preamble': () => 'Text before \\begin{document} is not shown.',
    'text-after-end': () => 'Text after \\end{document} is not shown.',
    'too-many': (a) => `${a} more problems are not listed.`,
    'missing-begin-document': () => 'Missing \\begin{document}: the text is shown as it is.',
    'unclosed-group': () => 'This { is never closed by a }.',
    'extra-close': () => 'This } closes nothing.',
    'unclosed-environment': (a) => `\\begin{${a}} is never closed by \\end{${a}}.`,
    'extra-end': (a) => `\\end{${a}} closes nothing.`,
    'unclosed-math': (a) => `This ${a} never ends its formula.`,
    'math-error': (a) => `In the formula: ${a}`,
    'math-unsupported': (a) => `${a} is not supported in formulas; it is marked where it appears.`,
    'misplaced-alignment': () => 'The & character only separates cells of a table or an aligned formula.',
    'missing-dollar': (a) => `${a} works only inside a formula ($…$).`,
    'parameter-outside-macro': () => 'The # character works only inside \\newcommand.',
    'missing-item': () => 'A list holds \\item entries; this text comes before the first one.',
    'lonely-item': () => '\\item outside of a list (itemize, enumerate or description).',
    'missing-argument': (a) => `${a} is missing its argument.`,
    'macro-loop': (a) => `${a} keeps expanding into itself.`
  },
  'pt-BR': {
    'unsupported-command': (a) => `${a} não é suportado pela prévia; aparece marcado onde está.`,
    'unsupported-environment': (a) => `O ambiente ${a} não é suportado pela prévia; o conteúdo aparece como está.`,
    'unsupported-class': (a) => `A classe ${a} é mostrada como article.`,
    'ignored-package': (a) => `O pacote ${a} é ignorado pela prévia.`,
    'package-in-body': () => '\\usepackage vai no preâmbulo, antes de \\begin{document}.',
    images: () => 'Imagens não aparecem na prévia.',
    citations: () => 'Citações e bibliografia não são suportadas; aparece a chave no lugar.',
    'undefined-reference': (a) => `A referência "${a}" não é definida por nenhum \\label.`,
    'duplicate-label': (a) => `O rótulo "${a}" é definido mais de uma vez.`,
    'text-in-preamble': () => 'Texto antes de \\begin{document} não aparece.',
    'text-after-end': () => 'Texto depois de \\end{document} não aparece.',
    'too-many': (a) => `Mais ${a} problemas não estão listados.`,
    'missing-begin-document': () => 'Falta \\begin{document}: o texto aparece como está.',
    'unclosed-group': () => 'Esta { nunca é fechada por uma }.',
    'extra-close': () => 'Esta } não fecha nada.',
    'unclosed-environment': (a) => `\\begin{${a}} nunca é fechado por \\end{${a}}.`,
    'extra-end': (a) => `\\end{${a}} não fecha nada.`,
    'unclosed-math': (a) => `Este ${a} nunca termina a fórmula.`,
    'math-error': (a) => `Na fórmula: ${a}`,
    'math-unsupported': (a) => `${a} não é suportado em fórmulas; aparece marcado onde está.`,
    'misplaced-alignment': () => 'O caractere & só separa células de uma tabela ou de uma fórmula alinhada.',
    'missing-dollar': (a) => `${a} só funciona dentro de uma fórmula ($…$).`,
    'parameter-outside-macro': () => 'O caractere # só funciona dentro de \\newcommand.',
    'missing-item': () => 'Uma lista é feita de \\item; este texto vem antes do primeiro.',
    'lonely-item': () => '\\item fora de uma lista (itemize, enumerate ou description).',
    'missing-argument': (a) => `Falta o argumento de ${a}.`,
    'macro-loop': (a) => `${a} se expande nele mesmo sem fim.`
  }
}

export function diagnosticMessage(locale: LatexLocale, code: DiagnosticCode, args: readonly string[] = []): string {
  return MESSAGES[locale][code](args[0] ?? '', args[1] ?? '', args[2] ?? '')
}

/** The words the document itself prints, by the document's language (babel, else the app's). */
export interface DocumentWords {
  abstract: string
  contents: string
  table: string
  figure: string
  /** \today */
  date: (d: Date) => string
}

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export const DOCUMENT_WORDS: Record<LatexLocale, DocumentWords> = {
  en: {
    abstract: 'Abstract',
    contents: 'Contents',
    table: 'Table',
    figure: 'Figure',
    date: (d) => `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
  },
  'pt-BR': {
    abstract: 'Resumo',
    contents: 'Sumário',
    table: 'Tabela',
    figure: 'Figura',
    date: (d) => `${d.getDate()} de ${MONTHS_PT[d.getMonth()]} de ${d.getFullYear()}`
  }
}

/** The words of the LaTeX screen and of the equation block. */
export interface LatexCopy {
  code: string
  split: string
  preview: string
  viewLabel: string
  exportTex: string
  exportPdf: string
  exporting: string
  exported: string
  couldNotExport: string
  rendering: string
  ok: string
  errors: (n: number) => string
  warnings: (n: number) => string
  line: (n: number) => string
  problems: string
  hideProblems: string
  showProblems: string
  loadFailed: string
  sourceLabel: string
  divider: string
  find: string
  findPlaceholder: string
  findNext: string
  findPrev: string
  findClose: string
  matches: (current: number, total: number) => string
  noMatches: string
  /** Equation block. */
  equationEmpty: string
  equationPlaceholder: string
  equationLabel: string
  equationDone: string
}

export const LATEX_COPY: Record<LatexLocale, LatexCopy> = {
  en: {
    code: 'Code',
    split: 'Both',
    preview: 'Preview',
    viewLabel: 'Show',
    exportTex: 'Export .tex',
    exportPdf: 'Export PDF',
    exporting: 'Exporting…',
    exported: 'Exported',
    couldNotExport: 'Could not export the document.',
    rendering: 'Rendering…',
    ok: 'No problems',
    errors: (n) => `${n} ${n === 1 ? 'error' : 'errors'}`,
    warnings: (n) => `${n} ${n === 1 ? 'warning' : 'warnings'}`,
    line: (n) => `Line ${n}`,
    problems: 'Problems',
    hideProblems: 'Hide problems',
    showProblems: 'Show problems',
    loadFailed: 'The LaTeX preview could not be loaded.',
    sourceLabel: 'LaTeX source',
    divider: 'Resize the source and the preview',
    find: 'Find',
    findPlaceholder: 'Find in the source',
    findNext: 'Next match',
    findPrev: 'Previous match',
    findClose: 'Close',
    matches: (current, total) => `${current} of ${total}`,
    noMatches: 'No matches',
    equationEmpty: 'Add an equation',
    equationPlaceholder: 'E = mc^2',
    equationLabel: 'Equation in LaTeX',
    equationDone: 'Done'
  },
  'pt-BR': {
    code: 'Código',
    split: 'Ambos',
    preview: 'Prévia',
    viewLabel: 'Mostrar',
    exportTex: 'Exportar .tex',
    exportPdf: 'Exportar PDF',
    exporting: 'Exportando…',
    exported: 'Exportado',
    couldNotExport: 'Não foi possível exportar o documento.',
    rendering: 'Renderizando…',
    ok: 'Nenhum problema',
    errors: (n) => `${n} ${n === 1 ? 'erro' : 'erros'}`,
    warnings: (n) => `${n} ${n === 1 ? 'aviso' : 'avisos'}`,
    line: (n) => `Linha ${n}`,
    problems: 'Problemas',
    hideProblems: 'Esconder problemas',
    showProblems: 'Mostrar problemas',
    loadFailed: 'Não foi possível carregar a prévia do LaTeX.',
    sourceLabel: 'Código LaTeX',
    divider: 'Redimensionar o código e a prévia',
    find: 'Buscar',
    findPlaceholder: 'Buscar no código',
    findNext: 'Próximo',
    findPrev: 'Anterior',
    findClose: 'Fechar',
    matches: (current, total) => `${current} de ${total}`,
    noMatches: 'Nada encontrado',
    equationEmpty: 'Adicionar uma equação',
    equationPlaceholder: 'E = mc^2',
    equationLabel: 'Equação em LaTeX',
    equationDone: 'Pronto'
  }
}

/** The source a new document starts with: a small article that shows what the preview can do. */
export function skeleton(locale: LatexLocale): string {
  if (locale === 'pt-BR') {
    return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[brazil]{babel}
\\usepackage{amsmath}

\\title{Título do documento}
\\author{Seu nome}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Um parágrafo curto sobre o que este documento apresenta.
\\end{abstract}

\\section{Introdução}
\\label{sec:introducao}

Escreva aqui. O texto pode ter \\emph{ênfase}, \\textbf{negrito} e matemática
no meio da frase, como $e^{i\\pi} + 1 = 0$.

\\begin{equation}
  \\int_0^1 x^2 \\, dx = \\frac{1}{3}
  \\label{eq:integral}
\\end{equation}

A Equação~\\eqref{eq:integral} está na Seção~\\ref{sec:introducao}.\\footnote{As notas de rodapé vão para o fim do documento.}

\\subsection{Uma lista}

\\begin{itemize}
  \\item Primeiro item
  \\item Segundo item
\\end{itemize}

\\end{document}
`
  }
  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[english]{babel}
\\usepackage{amsmath}

\\title{Document title}
\\author{Your name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
A short paragraph about what this document presents.
\\end{abstract}

\\section{Introduction}
\\label{sec:introduction}

Write here. The text can have \\emph{emphasis}, \\textbf{bold} and math in the
middle of a sentence, such as $e^{i\\pi} + 1 = 0$.

\\begin{equation}
  \\int_0^1 x^2 \\, dx = \\frac{1}{3}
  \\label{eq:integral}
\\end{equation}

Equation~\\eqref{eq:integral} is in Section~\\ref{sec:introduction}.\\footnote{Footnotes go to the end of the document.}

\\subsection{A list}

\\begin{itemize}
  \\item First item
  \\item Second item
\\end{itemize}

\\end{document}
`
}
