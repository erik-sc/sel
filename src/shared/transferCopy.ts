// The words of importing and exporting (./transfer.ts), in English and in Brazilian Portuguese:
// the rows in Settings, the dialog that shows an import before it is made, and the native
// dialogs of the main process. The language is the one of backups (./dataCopy.ts `dataLocale`).
import type { DataLocale } from './dataCopy'
import type { ImportCounts, ImportFormat } from './transfer'

export interface TransferCopy {
  // ---- Settings → General → Data
  importTitle: string
  importHelp: string
  fromNotion: string
  fromObsidian: string
  zipTitle: string
  zipHelp: string
  exportZip: string
  exporting: string
  exported: (pages: number, databases: number, images: number) => string
  // ---- the import dialog
  previewTitle: (format: ImportFormat) => string
  previewLead: (source: string) => string
  counts: (counts: ImportCounts) => string[]
  previewNote: string
  importNow: string
  cancel: string
  reading: string
  importing: string
  progress: (done: number, total: number) => string
  doneTitle: string
  doneLead: (counts: ImportCounts) => string
  openPage: string
  undo: string
  undone: string
  close: string
  failed: string
  nothingToImport: string
  // ---- the main process
  /** The page an import is made under. */
  importedOn: (day: string) => string
  chooseNotion: string
  notionFilter: string
  chooseObsidian: string
  saveZip: string
  zipFilter: string
  zipName: (day: string) => string
  indexTitle: string
  archiveFolder: string
  // ---- the command palette
  commandImportNotion: string
  commandImportObsidian: string
  commandExportZip: string
  commandExportPageZip: string
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const TRANSFER_COPY: Record<DataLocale, TransferCopy> = {
  en: {
    importTitle: 'Import from Notion or Obsidian',
    importHelp: 'Pages, databases, links and images, all under one new page. You see what comes in first.',
    fromNotion: 'Notion zip…',
    fromObsidian: 'Obsidian folder…',
    zipTitle: 'Export as a zip',
    zipHelp: 'Every page as Markdown in folders, each database as CSV, the images and an index. Opens in Obsidian.',
    exportZip: 'Save zip…',
    exporting: 'Exporting…',
    exported: (pages, databases, images) =>
      `Saved ${plural(pages, 'page', 'pages')}, ${plural(databases, 'database', 'databases')} and ${plural(images, 'image', 'images')}.`,
    previewTitle: (format) => (format === 'notion' ? 'Import from Notion' : 'Import from Obsidian'),
    previewLead: (source) => `In “${source}”:`,
    counts: (c) => [
      plural(c.pages, 'page', 'pages'),
      plural(c.databases, 'database', 'databases'),
      plural(c.attachments, 'image', 'images'),
      ...(c.skipped ? [`${plural(c.skipped, 'file', 'files')} sel cannot keep (their names stay as text)`] : []),
      ...(c.unresolved ? [`${plural(c.unresolved, 'link', 'links')} to pages that are not in it (their text stays)`] : [])
    ],
    previewNote: 'Everything goes under one new page, “Imported on …”. Deleting that page undoes the import.',
    importNow: 'Import',
    cancel: 'Cancel',
    reading: 'Reading…',
    importing: 'Importing…',
    progress: (done, total) => `${done} of ${total}`,
    doneTitle: 'Imported',
    doneLead: (c) => `${plural(c.pages, 'page', 'pages')} and ${plural(c.databases, 'database', 'databases')} are in.`,
    openPage: 'Open',
    undo: 'Undo import',
    undone: 'The import is in the trash.',
    close: 'Close',
    failed: 'Something went wrong. Nothing was imported.',
    nothingToImport: 'There are no pages in it to import.',
    importedOn: (day) => `Imported on ${day}`,
    chooseNotion: 'Choose a Notion export',
    notionFilter: 'Notion export',
    chooseObsidian: 'Choose an Obsidian vault',
    saveZip: 'Export as a zip',
    zipFilter: 'Zip file',
    zipName: (day) => `sel ${day}.zip`,
    indexTitle: 'Index',
    archiveFolder: 'Archive',
    commandImportNotion: 'Import from Notion…',
    commandImportObsidian: 'Import from Obsidian…',
    commandExportZip: 'Export everything as a zip…',
    commandExportPageZip: 'Export this page and its sub-pages as a zip…'
  },
  'pt-BR': {
    importTitle: 'Importar do Notion ou do Obsidian',
    importHelp: 'Páginas, databases, links e imagens, tudo debaixo de uma página nova. Você vê o que vai entrar antes.',
    fromNotion: 'Zip do Notion…',
    fromObsidian: 'Pasta do Obsidian…',
    zipTitle: 'Exportar em zip',
    zipHelp: 'Cada página em Markdown, em pastas, cada database em CSV, as imagens e um índice. Abre no Obsidian.',
    exportZip: 'Salvar zip…',
    exporting: 'Exportando…',
    exported: (pages, databases, images) =>
      `${plural(pages, 'página salva', 'páginas salvas')}, ${plural(databases, 'database', 'databases')} e ${plural(images, 'imagem', 'imagens')}.`,
    previewTitle: (format) => (format === 'notion' ? 'Importar do Notion' : 'Importar do Obsidian'),
    previewLead: (source) => `Em “${source}”:`,
    counts: (c) => [
      plural(c.pages, 'página', 'páginas'),
      plural(c.databases, 'database', 'databases'),
      plural(c.attachments, 'imagem', 'imagens'),
      ...(c.skipped ? [`${plural(c.skipped, 'arquivo', 'arquivos')} que o sel não guarda (o nome fica como texto)`] : []),
      ...(c.unresolved ? [`${plural(c.unresolved, 'link', 'links')} para páginas que não vêm junto (o texto fica)`] : [])
    ],
    previewNote: 'Tudo entra debaixo de uma página nova, “Importado em …”. Apagar essa página desfaz a importação.',
    importNow: 'Importar',
    cancel: 'Cancelar',
    reading: 'Lendo…',
    importing: 'Importando…',
    progress: (done, total) => `${done} de ${total}`,
    doneTitle: 'Importado',
    doneLead: (c) => `${plural(c.pages, 'página', 'páginas')} e ${plural(c.databases, 'database', 'databases')} entraram.`,
    openPage: 'Abrir',
    undo: 'Desfazer importação',
    undone: 'A importação foi para a lixeira.',
    close: 'Fechar',
    failed: 'Algo deu errado. Nada foi importado.',
    nothingToImport: 'Não há páginas para importar aí.',
    importedOn: (day) => `Importado em ${day}`,
    chooseNotion: 'Escolha um export do Notion',
    notionFilter: 'Export do Notion',
    chooseObsidian: 'Escolha um cofre do Obsidian',
    saveZip: 'Exportar em zip',
    zipFilter: 'Arquivo zip',
    zipName: (day) => `sel ${day}.zip`,
    indexTitle: 'Índice',
    archiveFolder: 'Arquivo',
    commandImportNotion: 'Importar do Notion…',
    commandImportObsidian: 'Importar do Obsidian…',
    commandExportZip: 'Exportar tudo em zip…',
    commandExportPageZip: 'Exportar esta página e as subpáginas em zip…'
  }
}
