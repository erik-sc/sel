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
  /** An empty chip: a field the task still lacks ("+ date"). */
  addField: Record<TaskField, string>
  /** Refining (shared/tasks/refine.ts): the list, its button, the refine mode, the line on Today. */
  refineList: string
  refine: string
  refineEmpty: string
  refining: string
  progress: (at: number, of: number) => string
  refineKeys: string
  /** The end of the walk, with nothing left to refine; and with something left (skipped). */
  refineDone: string
  refineLeft: string
  /** The walk's buttons under the card: back, skip, next. */
  refineBack: string
  refineSkip: string
  refineNext: string
  todayLine: (count: number) => string
  /** The row's menu: make the task its project's next action (shared/tasks/projects.ts). */
  makeNext: string
  nextSet: (title: string) => string
  /** A selection of rows (selection.ts): the count said politely, the row's mark, the menu entry. */
  selected: (count: number) => string
  selectionCleared: string
  selectAll: string
  selectedRow: string
  /** What a change to several tasks says once done (with Undo), and the header of the menus that make it. */
  manyChanged: (field: 'date' | 'priority' | 'project', count: number) => string
  manyCompleted: (count: number) => string
  manyReopened: (count: number) => string
  manyHeader: (count: number) => string
  /** The strip at the foot of a selection (SelectionBar.tsx): its name, the button that ends the selection, Let go and its question. */
  barLabel: string
  deselect: string
  markDone: string
  letGo: string
  letGoTitle: (count: number) => string
  letGoBody: string
  cancel: string
  letGone: (count: number) => string
  priorityHeader: (count: number) => string
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
  fromCompletion: 'from completion',
  addField: { date: '+ date', repeat: '+ repeat', priority: '+ priority', project: '+ project', labels: '+ labels', remind: '+ reminder' },
  refineList: 'To refine',
  refine: 'Refine',
  refineEmpty: 'Nothing to refine. Every open task has a date, a priority and a project.',
  refining: 'Refining',
  progress: (at, of) => `${at} of ${of}`,
  refineKeys: 'Enter next · S skip · Del delete · Esc leave · F2 name · D date · R repeat · 1–4 priority · # project · @ labels',
  refineDone: 'Inbox up to date.',
  refineLeft: 'That is all for now.',
  refineBack: '← Previous',
  refineSkip: 'Skip',
  refineNext: 'Next →',
  todayLine: (count) => `${count} to refine`,
  makeNext: 'Make next action',
  nextSet: (title) => `"${title}" is the project's next action.`,
  selected: (count) => `${count} selected`,
  selectionCleared: 'Selection cleared',
  selectAll: 'Select all in this list',
  selectedRow: 'selected',
  manyChanged: (field, count) =>
    `${{ date: 'Date', priority: 'Priority', project: 'Project' }[field]} changed on ${count} ${count === 1 ? 'task' : 'tasks'}.`,
  manyCompleted: (count) => `Completed ${count} ${count === 1 ? 'task' : 'tasks'}.`,
  manyReopened: (count) => `Reopened ${count} ${count === 1 ? 'task' : 'tasks'}.`,
  manyHeader: (count) => `Day for ${count} ${count === 1 ? 'task' : 'tasks'}`,
  barLabel: 'Selected tasks',
  deselect: 'Deselect',
  markDone: 'Done',
  letGo: 'Let go',
  letGoTitle: (count) => `Let go of ${count} tasks?`,
  letGoBody: 'They go to the Trash, and you can bring them back.',
  cancel: 'Cancel',
  letGone: (count) => `Let go of ${count} ${count === 1 ? 'task' : 'tasks'}.`,
  priorityHeader: (count) => `Priority for ${count} ${count === 1 ? 'task' : 'tasks'}`
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
  fromCompletion: 'a partir da conclusão',
  addField: {
    date: '+ data',
    repeat: '+ repetir',
    priority: '+ prioridade',
    project: '+ projeto',
    labels: '+ rótulos',
    remind: '+ lembrete'
  },
  refineList: 'A refinar',
  refine: 'Refinar',
  refineEmpty: 'Nada para refinar. Toda tarefa aberta tem data, prioridade e projeto.',
  refining: 'Refinando',
  progress: (at, of) => `${at} de ${of}`,
  refineKeys: 'Enter próxima · S pular · Del apagar · Esc sair · F2 nome · D data · R repetir · 1–4 prioridade · # projeto · @ rótulos',
  refineDone: 'Inbox em dia.',
  refineLeft: 'Por ora, é isso.',
  refineBack: '← Anterior',
  refineSkip: 'Pular',
  refineNext: 'Próxima →',
  todayLine: (count) => `${count} para refinar`,
  makeNext: 'Tornar próxima ação',
  nextSet: (title) => `"${title}" é a próxima ação do projeto.`,
  selected: (count) => (count === 1 ? '1 selecionada' : `${count} selecionadas`),
  selectionCleared: 'Seleção desfeita',
  selectAll: 'Selecionar tudo nesta lista',
  selectedRow: 'selecionada',
  manyChanged: (field, count) =>
    `${{ date: 'Data alterada', priority: 'Prioridade alterada', project: 'Projeto alterado' }[field]} em ${count} ${count === 1 ? 'tarefa' : 'tarefas'}.`,
  manyCompleted: (count) => (count === 1 ? '1 tarefa concluída.' : `${count} tarefas concluídas.`),
  manyReopened: (count) => (count === 1 ? '1 tarefa reaberta.' : `${count} tarefas reabertas.`),
  manyHeader: (count) => `Dia para ${count} ${count === 1 ? 'tarefa' : 'tarefas'}`,
  barLabel: 'Tarefas selecionadas',
  deselect: 'Desmarcar',
  markDone: 'Concluir',
  letGo: 'Deixar ir',
  letGoTitle: (count) => `Deixar ir ${count} tarefas?`,
  letGoBody: 'Elas vão para a lixeira, e dá para trazê-las de volta.',
  cancel: 'Cancelar',
  letGone: (count) => (count === 1 ? '1 tarefa deixada ir.' : `${count} tarefas deixadas ir.`),
  priorityHeader: (count) => `Prioridade para ${count} ${count === 1 ? 'tarefa' : 'tarefas'}`
}

export const TASK_COPY: Record<HomeLocale, TaskCopy> = { en: EN, 'pt-BR': PT }
