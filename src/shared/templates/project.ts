// A project: tasks on a board by status (with priority, owner, due date and milestone),
// milestones that show how far along their tasks are, meeting notes linked to the tasks they
// discussed, and an overview page that puts the brief and the linked views together.
import { asc, b, bullet, callout, chooser, database, desc, divider, h2, h3, inDays, line, linked, opt, p, page, prop, row, schema, todo, views, where } from './build'
import type { Template, TemplateLocale, TemplateNode } from './model'

export function project(locale: TemplateLocale): Template {
  const t = chooser(locale)
  const DONE = t('Feito', 'Done')
  const [A, B, C] = t(['Ana', 'Bruno', 'Carla'], ['Alex', 'Priya', 'Sam'])

  const tasks = schema(
    prop.title(t('Tarefa', 'Task')),
    prop.select('status', t('Situação', 'Status'), [
      opt('todo', t('A fazer', 'To do'), 'gray'),
      opt('doing', t('Fazendo', 'Doing'), 'blue'),
      opt('review', t('Em revisão', 'In review'), 'purple'),
      opt('done', DONE, 'green')
    ]),
    prop.select('priority', t('Prioridade', 'Priority'), [
      opt('high', t('Alta', 'High'), 'red'),
      opt('medium', t('Média', 'Medium'), 'yellow'),
      opt('low', t('Baixa', 'Low'), 'gray')
    ]),
    prop.select('owner', t('Responsável', 'Owner'), [opt('a', A, 'blue'), opt('b', B, 'orange'), opt('c', C, 'pink')]),
    prop.date('due', t('Prazo', 'Due')),
    prop.relation('milestone', t('Marco', 'Milestone'), 'milestones', { synced: 'tasks', one: true }),
    prop.number('estimate', t('Estimativa (h)', 'Estimate (h)')),
    prop.formula('late', t('Atrasada', 'Late'), `if(empty(prop("due")), false, prop("due") < today() and prop("status") != "${DONE}")`),
    prop.relation('meetings', t('Discutida em', 'Discussed in'), 'meetings', { synced: 'tasks' })
  )

  const milestones = schema(
    prop.title(t('Marco', 'Milestone')),
    prop.date('date', t('Data', 'Date')),
    prop.formula(
      'progress',
      t('Progresso', 'Progress'),
      `if(prop("total") == 0, 0, round((length(prop("statuses")) - length(replaceAll(prop("statuses"), "${DONE}", ""))) / ${DONE.length} / prop("total"), 2))`,
      'percent'
    ),
    prop.formula(
      'state',
      t('Andamento', 'Standing'),
      `ifs(prop("progress") >= 1, "${t('Concluído', 'Reached')}", empty(prop("date")), "", prop("date") < today(), "${t('Atrasado', 'Late')}", "${t('No prazo', 'On track')}")`
    ),
    prop.relation('tasks', t('Tarefas', 'Tasks'), 'tasks', { synced: 'milestone' }),
    prop.rollup('total', t('Tarefas no total', 'Tasks in all'), 'tasks', undefined, 'count'),
    prop.rollup('statuses', t('Situação das tarefas', 'Task statuses'), 'tasks', 'status', 'show_original')
  )

  const meetings = schema(
    prop.title(t('Reunião', 'Meeting')),
    prop.date('date', t('Data', 'Date')),
    prop.select('kind', t('Tipo', 'Kind'), [
      opt('kickoff', t('Início', 'Kick-off'), 'green'),
      opt('weekly', t('Semanal', 'Weekly'), 'blue'),
      opt('client', t('Com o cliente', 'With the client'), 'orange'),
      opt('retro', t('Retrospectiva', 'Retrospective'), 'purple')
    ]),
    prop.multi('people', t('Participantes', 'People'), [opt('a', A, 'blue'), opt('b', B, 'orange'), opt('c', C, 'pink'), opt('client', t('Cliente', 'Client'), 'gray')]),
    prop.relation('tasks', t('Tarefas citadas', 'Tasks discussed'), 'tasks', { synced: 'meetings' })
  )

  const notes = (agenda: string[], decisions: string[], next: string[]): TemplateNode[] => [
    h3(t('Pauta', 'Agenda')),
    ...agenda.map((item) => bullet(item)),
    h3(t('Decisões', 'Decisions')),
    ...decisions.map((item) => bullet(item)),
    h3(t('Próximos passos', 'Next steps')),
    ...next.map((item) => todo(item))
  ]

  const task = (key: string, title: string, status: string, priority: string, owner: string, due: number, milestone: string, estimate: number) =>
    row(key, title, { status, priority, owner, due: inDays(due), milestone: [milestone], estimate })

  return {
    id: 'project',
    locale,
    name: t('Projeto', 'Project'),
    description: t('Tarefas num quadro, marcos com progresso, notas de reunião e uma visão geral.', 'Tasks on a board, milestones with progress, meeting notes and an overview.'),
    icon: 'path',
    page: page(t('Projeto', 'Project'), line('path'), [
      callout(
        line('star'),
        t(
          [b('Objetivo: '), ['em uma frase, o que este projeto entrega e para quando. Exemplo: lançar o site novo até o fim do trimestre, com o blog e a loja no mesmo lugar.']],
          [b('Goal: '), ['in one sentence, what this project delivers and by when. For example: launch the new website by the end of the quarter, with the blog and the shop in one place.']]
        ),
        'yellow_background'
      ),
      h2(t('Visão geral', 'Overview')),
      bullet([b(t('Por que agora: ', 'Why now: ')), [t('o problema que o projeto resolve, e por que ele não pode esperar.', 'the problem it solves, and why it cannot wait.')]]),
      bullet([b(t('Quem participa: ', "Who's involved: ")), [t('nomes e papéis; quem decide no fim.', 'names and roles; who has the final say.')]]),
      bullet([b(t('Fora do escopo: ', 'Out of scope: ')), [t('o que fica de fora de propósito, para não voltar a cada reunião.', 'what is left out on purpose, so it does not come back at every meeting.')]]),
      h2(t('Em andamento', 'In progress')),
      linked('tasks', [views.board(t('Quadro', 'Board'), 'status', ['priority', 'owner', 'due'])], { title: t('Tarefas', 'Tasks') }),
      h2(t('Próximos dias', 'Coming up')),
      linked(
        'tasks',
        [
          views.table(t('Próximos 7 dias', 'Next 7 days'), ['title', 'owner', 'due', 'priority'], { filters: [where.date('due', 'next_7_days')], sorts: [asc('due')] }),
          views.table(t('Atrasadas', 'Late'), ['title', 'owner', 'due', 'status'], { filters: [where.checked('late')], sorts: [asc('due')] })
        ],
        { title: t('Prazos', 'Deadlines') }
      ),
      linked(
        'tasks',
        [
          views.chart(t('Por responsável', 'By owner'), {
            kind: 'bar',
            x: 'owner',
            y: { aggregate: 'count' },
            series: 'status',
            stacked: true,
            palette: 'options',
            showLegend: true,
            sort: 'manual',
            height: 200
          })
        ],
        { title: t('Quem está com o quê', "Who's on what"), beside: true }
      ),
      h2(t('Marcos', 'Milestones')),
      linked('milestones', [views.table(t('Marcos', 'Milestones'), ['title', 'date', 'progress', 'state', 'total'], { sorts: [asc('date')] })]),
      h2(t('Reuniões', 'Meetings')),
      linked('meetings', [views.list(t('Recentes', 'Recent'), ['date', 'kind', 'people'], { sorts: [desc('date')] })]),
      divider(),
      h2(t('Dados do projeto', 'Project data')),
      p(t('As bases que as visões acima mostram. Uma tarefa nova aqui aparece no quadro, nos prazos e no marco dela.', 'Where the views above read from. A new task here shows up on the board, in the deadlines and in its milestone.')),
      database(
        'tasks',
        t('Tarefas', 'Tasks'),
        line('page'),
        tasks,
        [
          views.board(t('Quadro', 'Board'), 'status', ['priority', 'owner', 'due']),
          views.table(t('Todas', 'All'), ['title', 'status', 'priority', 'owner', 'due', 'milestone', 'estimate', 'late'], { sorts: [asc('due')] }),
          views.calendar(t('Calendário', 'Calendar'), 'due', ['title', 'owner']),
          views.board(t('Por prioridade', 'By priority'), 'priority', ['status', 'owner', 'due'], { filters: [where.isNot('status', 'done')] })
        ],
        [
          task('sitemap', t('Definir o mapa do site', 'Agree on the sitemap'), 'done', 'high', 'a', -20, 'discovery', 4),
          task('interviews', t('Entrevistar cinco clientes', 'Interview five customers'), 'done', 'high', 'b', -15, 'discovery', 6),
          task('wireframes', t('Wireframes da página inicial', 'Home page wireframes'), 'done', 'medium', 'c', -8, 'discovery', 8),
          task('type', t('Escolher fontes e cores', 'Choose type and colours'), 'review', 'medium', 'c', -1, 'design', 3),
          task('copy', t('Escrever os textos da página inicial', 'Write the home page copy'), 'doing', 'high', 'a', 3, 'design', 5),
          task('components', t('Montar os componentes', 'Build the components'), 'doing', 'medium', 'b', 5, 'design', 12),
          task('posts', t('Migrar os posts do blog', 'Move the blog posts over'), 'todo', 'medium', 'b', 12, 'launch', 6),
          task('redirects', t('Configurar os redirecionamentos', 'Set up redirects'), 'todo', 'high', 'b', 18, 'launch', 2),
          task('mobile', t('Testar no celular', 'Test on phones'), 'todo', 'high', 'c', 20, 'launch', 4),
          task('a11y', t('Revisão de acessibilidade', 'Accessibility review'), 'todo', 'medium', 'a', 22, 'launch', 3),
          task('announce', t('Publicar e anunciar', 'Publish and announce'), 'todo', 'low', 'a', 28, 'launch', 2)
        ]
      ),
      database(
        'milestones',
        t('Marcos', 'Milestones'),
        line('mountain'),
        milestones,
        [
          views.table(t('Marcos', 'Milestones'), ['title', 'date', 'progress', 'state', 'total', 'tasks'], { sorts: [asc('date')] }),
          views.calendar(t('Linha do tempo', 'Timeline'), 'date', ['title'])
        ],
        [
          row('discovery', t('Descoberta concluída', 'Discovery done'), { date: inDays(-7) }),
          row('design', t('Design aprovado', 'Design signed off'), { date: inDays(7) }),
          row('launch', t('Site no ar', 'Site live'), { date: inDays(28) })
        ]
      ),
      database(
        'meetings',
        t('Notas de reunião', 'Meeting notes'),
        line('feather'),
        meetings,
        [
          views.list(t('Todas', 'All'), ['date', 'kind', 'people'], { sorts: [desc('date')] }),
          views.calendar(t('Calendário', 'Calendar'), 'date', ['title'])
        ],
        [
          row(
            undefined,
            t('Início do projeto', 'Project kick-off'),
            { date: inDays(-21, '10:00'), kind: 'kickoff', people: ['a', 'b', 'c', 'client'], tasks: ['sitemap', 'interviews'] },
            notes(
              [t('Objetivo e prazo', 'Goal and deadline'), t('Quem faz o quê', "Who does what"), t('Como vamos decidir', 'How we decide')],
              [t('Lançamento em quatro semanas, com o blog junto.', 'Launch in four weeks, blog included.'), t(`${A} decide o conteúdo; ${C}, o visual.`, `${A} owns the content; ${C}, the look.`)],
              [t('Marcar as entrevistas com clientes', 'Book the customer interviews'), t('Levantar as páginas atuais', 'List the current pages')]
            )
          ),
          row(
            undefined,
            t('Semanal', 'Weekly check-in'),
            { date: inDays(-7, '09:30'), kind: 'weekly', people: ['a', 'b', 'c'], tasks: ['wireframes', 'type'] },
            notes(
              [t('O que ficou pronto', 'What got done'), t('O que está travado', "What's stuck")],
              [t('Os wireframes estão aprovados; seguimos para o visual.', 'Wireframes approved; moving on to the visual design.')],
              [t('Mandar duas opções de fontes', 'Send two type options')]
            )
          ),
          row(
            undefined,
            t('Revisão do design com o cliente', 'Design review with the client'),
            { date: inDays(-2, '15:00'), kind: 'client', people: ['a', 'c', 'client'], tasks: ['type', 'copy'] },
            notes(
              [t('Fontes e cores', 'Type and colours'), t('Texto da página inicial', 'Home page copy')],
              [t('A opção B ganhou, com um tom mais quente.', 'Option B won, a little warmer.')],
              [t('Ajustar a paleta', 'Adjust the palette'), t('Enviar o texto até sexta', 'Send the copy by Friday')]
            )
          )
        ]
      )
    ])
  }
}
