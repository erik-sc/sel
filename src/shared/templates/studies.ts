// Studies: the subjects of a term, the notes of each class linked to its subject, the reading
// list, and the exams and assignments on a calendar, each saying how long is left. A subject
// rolls up its classes, what was handed in and the average of its grades.
import { asc, b, bullet, callout, chooser, database, desc, divider, h2, h3, inDays, line, linked, opt, p, page, prop, row, schema, views, where } from './build'
import type { Template, TemplateLocale, TemplateNode, TemplateValue } from './model'

/**
 * Hook for LaTeX documents (feature 9 of release 0.6.0). When sel can make a LaTeX document,
 * return here the block that makes an example one (a short article with a title, a section and
 * an equation, in the template's language): the Studies page then shows it under its own
 * heading. Until then there is none, and the section is left out.
 */
export function latexExample(_locale: TemplateLocale): TemplateNode | null {
  return null
}

export function studies(locale: TemplateLocale): Template {
  const t = chooser(locale)
  const HANDED = t('Entregue', 'Handed in')

  const subjects = schema(
    prop.title(t('Disciplina', 'Subject')),
    prop.text('teacher', t('Professor(a)', 'Teacher')),
    prop.text('schedule', t('Horário', 'When')),
    prop.text('room', t('Sala', 'Room')),
    prop.number('credits', t('Créditos', 'Credits')),
    prop.relation('lessons', t('Aulas', 'Classes'), 'lessons', { synced: 'subject' }),
    prop.relation('readings', t('Leituras', 'Readings'), 'readings', { synced: 'subject' }),
    prop.relation('assessments', t('Provas e entregas', 'Exams and assignments'), 'assessments', { synced: 'subject' }),
    prop.rollup('lessonCount', t('Aulas anotadas', 'Classes noted'), 'lessons', undefined, 'count'),
    prop.rollup('handedIn', t('Entregue', 'Handed in'), 'assessments', 'done', 'percent_checked'),
    prop.rollup('average', t('Média', 'Average grade'), 'assessments', 'grade', 'average')
  )

  const lessons = schema(
    prop.title(t('Aula', 'Class')),
    prop.date('date', t('Data', 'Date')),
    prop.relation('subject', t('Disciplina', 'Subject'), 'subjects', { synced: 'lessons', one: true }),
    prop.select('kind', t('Tipo', 'Kind'), [
      opt('lecture', t('Teórica', 'Lecture'), 'blue'),
      opt('lab', t('Prática', 'Lab'), 'green'),
      opt('seminar', t('Seminário', 'Seminar'), 'purple'),
      opt('tutorial', t('Monitoria', 'Tutorial'), 'orange')
    ]),
    prop.checkbox('reviewed', t('Revisada', 'Reviewed')),
    prop.text('questions', t('Dúvidas', 'Questions'))
  )

  const readings = schema(
    prop.title(t('Leitura', 'Reading')),
    prop.text('author', t('Autor', 'Author')),
    prop.relation('subject', t('Disciplina', 'Subject'), 'subjects', { synced: 'readings', one: true }),
    prop.text('pages', t('Trecho', 'Pages')),
    prop.select('status', t('Situação', 'Status'), [
      opt('todo', t('A ler', 'To read'), 'gray'),
      opt('reading', t('Lendo', 'Reading'), 'blue'),
      opt('read', t('Lida', 'Read'), 'green')
    ]),
    prop.date('by', t('Até', 'By'))
  )

  const assessments = schema(
    prop.title(t('O quê', 'What')),
    prop.select('kind', t('Tipo', 'Kind'), [
      opt('exam', t('Prova', 'Exam'), 'red'),
      opt('paper', t('Trabalho', 'Paper'), 'purple'),
      opt('problems', t('Lista de exercícios', 'Problem set'), 'blue'),
      opt('talk', t('Seminário', 'Presentation'), 'orange')
    ]),
    prop.date('date', t('Data', 'Date')),
    prop.relation('subject', t('Disciplina', 'Subject'), 'subjects', { synced: 'assessments', one: true }),
    prop.number('weight', t('Peso', 'Weight'), 'percent'),
    prop.number('grade', t('Nota', 'Grade')),
    prop.checkbox('done', HANDED),
    prop.formula(
      'left',
      t('Falta', 'Time left'),
      `ifs(prop("done"), "${t('Entregue', 'Handed in')}", empty(prop("date")), "", dateBetween(prop("date"), today(), "days") < 0, "${t('Passou', 'Past')}", dateBetween(prop("date"), today(), "days") == 0, "${t('Hoje', 'Today')}", dateBetween(prop("date"), today(), "days") == 1, "${t('Amanhã', 'Tomorrow')}", "${t('Em ', 'In ')}" + format(dateBetween(prop("date"), today(), "days")) + "${t(' dias', ' days')}")`
    )
  )

  const cornell = (ideas: string[], questions: string[], summary: string): TemplateNode[] => [
    h3(t('Ideias principais', 'Main ideas')),
    ...ideas.map((idea) => bullet(idea)),
    h3(t('Dúvidas para a monitoria', 'Questions to ask')),
    ...questions.map((question) => bullet(question)),
    h3(t('Resumo em três linhas', 'Summary in three lines')),
    p(summary)
  ]

  const lesson = (title: string, days: number, subject: string, kind: string, reviewed: boolean, body: TemplateNode[], extra: Record<string, TemplateValue> = {}) =>
    row(undefined, title, { date: inDays(days), subject: [subject], kind, reviewed, ...extra }, body)

  const latex = latexExample(locale)

  return {
    id: 'studies',
    locale,
    name: t('Estudos', 'Studies'),
    description: t('Disciplinas, anotações de aula, leituras e um calendário de provas e entregas.', 'Subjects, class notes, readings and a calendar of exams and assignments.'),
    icon: 'spectacles',
    page: page(t('Estudos', 'Studies'), line('spectacles'), [
      callout(
        line('lantern'),
        t(
          [['Depois de cada aula, abra uma página em '], b('Aulas e anotações'), [' e ligue-a à disciplina. Provas e entregas avisam quanto tempo falta.']],
          [['After each class, start a page in '], b('Class notes'), [' and link it to its subject. Exams and assignments tell you how long is left.']]
        )
      ),
      h2(t('Esta semana', 'This week')),
      linked(
        'assessments',
        [views.table(t('Próximos 7 dias', 'Next 7 days'), ['title', 'subject', 'left', 'kind'], { filters: [where.unchecked('done'), where.date('date', 'next_7_days')], sorts: [asc('date')] })],
        { title: t('Vem aí', 'Coming up') }
      ),
      linked('lessons', [views.list(t('Para revisar', 'To review'), ['subject', 'date'], { filters: [where.unchecked('reviewed')], sorts: [asc('date')] })], {
        title: t('Aulas para revisar', 'Classes to review'),
        beside: true
      }),
      h2(t('Calendário', 'Calendar')),
      linked('assessments', [views.calendar(t('Provas e entregas', 'Exams and assignments'), 'date', ['title', 'subject'])], { title: t('Provas e entregas', 'Exams and assignments') }),
      h2(t('Disciplinas', 'Subjects')),
      linked('subjects', [views.gallery(t('Semestre', 'This term'), ['teacher', 'schedule', 'lessonCount', 'handedIn', 'average'])], { title: t('Este semestre', 'This term') }),
      ...(latex ? [h2(t('Trabalhos escritos', 'Writing')), latex] : []),
      divider(),
      h2(t('Cadernos', 'Notebooks')),
      p(t('Onde as visões acima leem. Uma aula, leitura ou prova ligada a uma disciplina aparece também na página dela.', 'Where the views above read from. A class, reading or exam linked to a subject also shows up on its page.')),
      database(
        'subjects',
        t('Disciplinas', 'Subjects'),
        line('book'),
        subjects,
        [
          views.gallery(t('Semestre', 'This term'), ['teacher', 'schedule', 'lessonCount', 'handedIn', 'average']),
          views.table(t('Tabela', 'Table'), ['title', 'teacher', 'schedule', 'room', 'credits', 'lessonCount', 'handedIn', 'average'])
        ],
        [
          row('calc', t('Cálculo II', 'Calculus II'), {
            teacher: t('Prof.ª Helena Duarte', 'Prof. Helen Ward'),
            schedule: t('Seg e qua, 8h', 'Mon and Wed, 8am'),
            room: t('Bloco B, 204', 'Hall B, 204'),
            credits: 4
          }),
          row('stats', t('Estatística', 'Statistics'), {
            teacher: t('Prof. Marcos Lima', 'Dr. Mark Lee'),
            schedule: t('Ter, 10h', 'Tue, 10am'),
            room: t('Laboratório 3', 'Lab 3'),
            credits: 4
          }),
          row('philosophy', t('Filosofia da Ciência', 'Philosophy of Science'), {
            teacher: t('Prof.ª Júlia Campos', 'Prof. Julia Kemp'),
            schedule: t('Qui, 19h', 'Thu, 7pm'),
            room: t('Bloco A, 110', 'Hall A, 110'),
            credits: 2
          })
        ]
      ),
      database(
        'lessons',
        t('Aulas e anotações', 'Class notes'),
        line('feather'),
        lessons,
        [
          views.list(t('Mais recentes', 'Latest'), ['subject', 'date', 'kind', 'reviewed'], { sorts: [desc('date')] }),
          views.table(t('Tabela', 'Table'), ['title', 'date', 'subject', 'kind', 'reviewed', 'questions'], { sorts: [desc('date')] }),
          views.calendar(t('Calendário', 'Calendar'), 'date', ['title', 'subject'])
        ],
        [
          lesson(
            t('Integrais duplas', 'Double integrals'),
            -9,
            'calc',
            'lecture',
            true,
            cornell(
              [t('A integral dupla soma volumes sob uma superfície.', 'A double integral adds up the volume under a surface.'), t('Teorema de Fubini: trocar a ordem quando as regiões permitem.', "Fubini's theorem: swap the order when the region allows.")],
              [t('Como escolher a ordem de integração numa região não retangular?', 'How do I pick the order for a non-rectangular region?')],
              t('Integrar duas vezes, uma variável de cada vez, com os limites desenhados antes.', 'Integrate twice, one variable at a time, with the region drawn first.')
            )
          ),
          lesson(
            t('Coordenadas polares', 'Polar coordinates'),
            -2,
            'calc',
            'lecture',
            false,
            cornell(
              [t('dA = r dr dθ', 'dA = r dr dθ'), t('Regiões circulares ficam retangulares em (r, θ).', 'Circular regions become rectangles in (r, θ).')],
              [t('Por que aparece o r no dA?', 'Why is there an r in dA?')],
              t('Trocar para polares quando a região ou a função têm x² + y².', 'Switch to polar when the region or the function has x² + y².')
            ),
            { questions: t('O jacobiano', 'The Jacobian') }
          ),
          lesson(
            t('Distribuição normal', 'The normal distribution'),
            -6,
            'stats',
            'lecture',
            true,
            cornell(
              [t('Média e desvio-padrão definem a curva.', 'Mean and standard deviation define the curve.'), t('68% dos valores ficam a um desvio da média.', '68% of values lie within one standard deviation.')],
              [t('Quando dá para aproximar a binomial pela normal?', 'When can a binomial be approximated by a normal?')],
              t('Padronizar com z = (x − μ)/σ e ler a tabela.', 'Standardise with z = (x − μ)/σ and read the table.')
            )
          ),
          lesson(
            t('Laboratório: intervalos de confiança', 'Lab: confidence intervals'),
            -1,
            'stats',
            'lab',
            false,
            cornell(
              [t('Simulamos 100 amostras e contamos quantos intervalos acertam a média.', 'We simulated 100 samples and counted how many intervals caught the mean.')],
              [t('O que muda com amostras menores?', 'What changes with smaller samples?')],
              t('95% de confiança fala do método, não de um intervalo.', '95% confidence describes the method, not one interval.')
            )
          ),
          lesson(
            t('Kuhn e as revoluções científicas', 'Kuhn and scientific revolutions'),
            -7,
            'philosophy',
            'seminar',
            true,
            cornell(
              [t('Ciência normal resolve quebra-cabeças dentro de um paradigma.', 'Normal science solves puzzles inside a paradigm.'), t('Anomalias acumuladas levam à crise.', 'Anomalies pile up into a crisis.')],
              [t('Paradigmas são mesmo incomensuráveis?', 'Are paradigms really incommensurable?')],
              t('A ciência não avança só somando fatos; às vezes troca o jeito de ver.', 'Science does not only add facts; sometimes it changes how it sees.')
            )
          )
        ]
      ),
      database(
        'readings',
        t('Leituras', 'Readings'),
        line('spectacles'),
        readings,
        [
          views.board(t('Por situação', 'By status'), 'status', ['subject', 'pages', 'by']),
          views.table(t('Tabela', 'Table'), ['title', 'author', 'subject', 'pages', 'status', 'by'], { sorts: [asc('by')] })
        ],
        [
          row(undefined, t('A estrutura das revoluções científicas', 'The Structure of Scientific Revolutions'), { author: 'Thomas Kuhn', subject: ['philosophy'], pages: t('cap. 1 a 3', 'ch. 1–3'), status: 'read', by: inDays(-7) }),
          row(undefined, t('Conjecturas e refutações', 'Conjectures and Refutations'), { author: 'Karl Popper', subject: ['philosophy'], pages: t('cap. 1', 'ch. 1'), status: 'reading', by: inDays(6) }),
          row(undefined, t('Cálculo, volume 2', 'Calculus'), { author: 'James Stewart', subject: ['calc'], pages: t('seção 15.3', 'section 15.3'), status: 'todo', by: inDays(4) }),
          row(undefined, t('Estatística básica', 'OpenIntro Statistics'), { author: t('Bussab e Morettin', 'Diez, Çetinkaya-Rundel and Barr'), subject: ['stats'], pages: t('cap. 7', 'ch. 5'), status: 'todo', by: inDays(8) })
        ]
      ),
      database(
        'assessments',
        t('Provas e entregas', 'Exams and assignments'),
        line('hourglass'),
        assessments,
        [
          views.calendar(t('Calendário', 'Calendar'), 'date', ['title', 'subject']),
          views.table(t('Próximas', 'Upcoming'), ['title', 'kind', 'subject', 'date', 'left', 'weight'], { filters: [where.unchecked('done')], sorts: [asc('date')] }),
          views.table(t('Notas', 'Grades'), ['title', 'subject', 'weight', 'grade'], { filters: [where.notEmpty('grade')], sorts: [desc('date')] })
        ],
        [
          row(undefined, t('Lista 3', 'Problem set 3'), { kind: 'problems', date: inDays(-4, '23:59'), subject: ['calc'], weight: 0.1, grade: t(9, 92), done: true }),
          row(undefined, t('Prova 1', 'Midterm'), { kind: 'exam', date: inDays(-10, '10:00'), subject: ['stats'], weight: 0.3, grade: t(8.5, 87), done: true }),
          row(undefined, t('Lista 4', 'Problem set 4'), { kind: 'problems', date: inDays(3, '23:59'), subject: ['calc'], weight: 0.1, done: false }),
          row(undefined, t('Relatório do laboratório', 'Lab report'), { kind: 'paper', date: inDays(6, '18:00'), subject: ['stats'], weight: 0.2, done: false }),
          row(undefined, t('Prova 2', 'Exam 2'), { kind: 'exam', date: inDays(12, '08:00'), subject: ['calc'], weight: 0.35, done: false }),
          row(undefined, t('Seminário sobre Popper', 'Presentation on Popper'), { kind: 'talk', date: inDays(16, '19:00'), subject: ['philosophy'], weight: 0.4, done: false })
        ]
      )
    ])
  }
}
