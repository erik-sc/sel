// The words of a task row, its menu, its editors and the task panel, in English and in Brazilian
// Portuguese, in the language of the home (home/copy.ts). Pure: no React, no DOM.
import type { HomeLocale } from '../home/copy'

/** What a list calls a day near today. */
export interface DayWords {
  today: string
  tomorrow: string
  yesterday: string
  /** The `Intl` locale weekdays and dates are written in; undefined for the system's. */
  locale?: string
}

export type TaskField = 'date' | 'repeat' | 'priority' | 'project' | 'labels' | 'remind'

export interface TaskCopy {
  days: DayWords
  untitled: string
  /** What each field is called: the chip's name, the menu item, the panel's label. */
  field: Record<TaskField, string>
  /** The row as a screen reader hears it. */
  rowLabel: (title: string, details: string[]) => string
  complete: (title: string) => string
  reopen: (title: string) => string
  repeats: string
  noPriority: string
  noProject: string
  priorityName: (level: 1 | 2 | 3 | 4) => string
  /** Chip text of a reminder: "⏰ Tomorrow 9:00". */
  more: (title: string) => string
  rename: string
  renameLabel: string
  renameHint: string
  openPage: string
  openInTab: string
  openPanel: string
  delete: string
  deleted: (title: string) => string
  undo: string
  undone: string
  deleteFailed: string
  restoreFailed: string
  saveFailed: string
  /** The panel. */
  panel: string
  close: string
  subtasks: string
  addSubtask: string
  notes: string
  openAsPage: string
  gone: string
  /** A field's chip, for the screen reader: "Date: Tomorrow. Change". */
  change: (field: string, value: string) => string
  none: string
  /** Inline edit: what the parser recognised, read after the field. */
  willSet: (parts: string[]) => string
  fromCompletion: string
}

const EN: TaskCopy = {
  days: { today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday' },
  untitled: 'Untitled',
  field: { date: 'Date', repeat: 'Repeat', priority: 'Priority', project: 'Project', labels: 'Labels', remind: 'Reminder' },
  rowLabel: (title, details) => [title, ...details].join(', '),
  complete: (title) => `Complete "${title}"`,
  reopen: (title) => `Mark "${title}" as not done`,
  repeats: 'Repeats',
  noPriority: 'No priority',
  noProject: 'No project',
  priorityName: (level) => `Priority ${level}`,
  more: (title) => `More for "${title}"`,
  rename: 'Rename',
  renameLabel: 'Task name',
  renameHint: 'Enter to save, Esc to cancel. Dates, p1–p4, #project and @label are read as you type.',
  openPage: 'Open page',
  openInTab: 'Open in new tab',
  openPanel: 'Open details',
  delete: 'Delete',
  deleted: (title) => `Deleted "${title}".`,
  undo: 'Undo',
  undone: 'Put back.',
  deleteFailed: 'Could not delete the task.',
  restoreFailed: 'Could not bring the task back.',
  saveFailed: 'Could not save the change to the task.',
  panel: 'Task details',
  close: 'Close',
  subtasks: 'Subtasks',
  addSubtask: 'Add a subtask',
  notes: 'Notes',
  openAsPage: 'Open as page',
  gone: 'This task is no longer here.',
  change: (field, value) => `${field}: ${value}`,
  none: 'none',
  willSet: (parts) => `Will set ${parts.join(', ')}`,
  fromCompletion: 'from completion'
}

const PT: TaskCopy = {
  days: { today: 'Hoje', tomorrow: 'Amanhã', yesterday: 'Ontem', locale: 'pt-BR' },
  untitled: 'Sem título',
  field: { date: 'Data', repeat: 'Repetir', priority: 'Prioridade', project: 'Projeto', labels: 'Rótulos', remind: 'Lembrete' },
  rowLabel: (title, details) => [title, ...details].join(', '),
  complete: (title) => `Concluir "${title}"`,
  reopen: (title) => `Reabrir "${title}"`,
  repeats: 'Repete',
  noPriority: 'Sem prioridade',
  noProject: 'Sem projeto',
  priorityName: (level) => `Prioridade ${level}`,
  more: (title) => `Mais de "${title}"`,
  rename: 'Renomear',
  renameLabel: 'Nome da tarefa',
  renameHint: 'Enter salva, Esc cancela. Datas, p1–p4, #projeto e @rótulo são lidos enquanto você digita.',
  openPage: 'Abrir página',
  openInTab: 'Abrir em nova aba',
  openPanel: 'Abrir detalhes',
  delete: 'Apagar',
  deleted: (title) => `"${title}" apagada.`,
  undo: 'Desfazer',
  undone: 'Voltou para onde estava.',
  deleteFailed: 'Não foi possível apagar a tarefa.',
  restoreFailed: 'Não foi possível trazer a tarefa de volta.',
  saveFailed: 'Não foi possível salvar a mudança na tarefa.',
  panel: 'Detalhes da tarefa',
  close: 'Fechar',
  subtasks: 'Subtarefas',
  addSubtask: 'Adicionar subtarefa',
  notes: 'Notas',
  openAsPage: 'Abrir como página',
  gone: 'Esta tarefa não está mais aqui.',
  change: (field, value) => `${field}: ${value}`,
  none: 'nenhum',
  willSet: (parts) => `Vai definir ${parts.join(', ')}`,
  fromCompletion: 'a partir da conclusão'
}

export const TASK_COPY: Record<HomeLocale, TaskCopy> = { en: EN, 'pt-BR': PT }
