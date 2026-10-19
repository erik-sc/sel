// The quick-add parser's cases. Each zone runs them from its own file (the zone is process-wide
// state): the answers must not depend on where the computer is, only on its local day.
import { describe, expect, it } from 'vitest'
import { parseTask, type ParsedTask, type ParseOptions } from './parse'

/** Thursday 15 October 2026, 10:00 local time. */
const NOW = (): Date => new Date(2026, 9, 15, 10, 0)

type Expect = Partial<Omit<ParsedTask, 'tokens' | 'recurrence'>> & { rule?: string | null; from?: 'due' | 'completion' }

const CASES: [string, Expect, ParseOptions?][] = [
  // ---- days, pt-BR
  ['Pagar aluguel hoje', { title: 'Pagar aluguel', due: '2026-10-15' }],
  ['Pagar aluguel amanhã', { title: 'Pagar aluguel', due: '2026-10-16' }],
  ['Pagar aluguel amanha', { title: 'Pagar aluguel', due: '2026-10-16' }],
  ['Ligar depois de amanhã', { title: 'Ligar', due: '2026-10-17' }],
  ['Reunião segunda', { title: 'Reunião', due: '2026-10-19' }],
  ['Reunião segunda-feira', { title: 'Reunião', due: '2026-10-19' }],
  ['Reunião na seg', { title: 'Reunião', due: '2026-10-19' }],
  ['Entregar quinta', { title: 'Entregar', due: '2026-10-15' }],
  ['Entregar até sexta', { title: 'Entregar', due: '2026-10-16' }],
  ['Entregar sexta que vem', { title: 'Entregar', due: '2026-10-23' }],
  ['Entregar próxima terça', { title: 'Entregar', due: '2026-10-20' }],
  ['Dentista dia 20', { title: 'Dentista', due: '2026-10-20' }],
  ['Dentista dia 3', { title: 'Dentista', due: '2026-11-03' }],
  ['Dentista 20/10', { title: 'Dentista', due: '2026-10-20' }],
  ['Dentista 20/10/2027', { title: 'Dentista', due: '2027-10-20' }],
  ['Dentista 03/02', { title: 'Dentista', due: '2027-02-03' }],
  ['Dentista 15 out', { title: 'Dentista', due: '2026-10-15' }],
  ['Dentista 2 de novembro', { title: 'Dentista', due: '2026-11-02' }],
  ['Renovar em 3 dias', { title: 'Renovar', due: '2026-10-18' }],
  ['Renovar daqui a 2 semanas', { title: 'Renovar', due: '2026-10-29' }],
  ['Renovar em um mês', { title: 'Renovar', due: '2026-11-15' }],
  ['Faxina fim de semana', { title: 'Faxina', due: '2026-10-17' }],
  ['Planejar semana que vem', { title: 'Planejar', due: '2026-10-19' }],
  ['Planejar mês que vem', { title: 'Planejar', due: '2026-11-01' }],
  // ---- days, en
  ['Pay rent today', { title: 'Pay rent', due: '2026-10-15' }],
  ['Pay rent tomorrow', { title: 'Pay rent', due: '2026-10-16' }],
  ['Call day after tomorrow', { title: 'Call', due: '2026-10-17' }],
  ['Meeting monday', { title: 'Meeting', due: '2026-10-19' }],
  ['Meeting on mon', { title: 'Meeting', due: '2026-10-19' }],
  ['Meeting on sat', { title: 'Meeting', due: '2026-10-17' }],
  ['Ship next friday', { title: 'Ship', due: '2026-10-23' }],
  ['Dentist the 20th', { title: 'Dentist', due: '2026-10-20' }],
  ['Dentist Oct 20', { title: 'Dentist', due: '2026-10-20' }],
  ['Dentist October 20, 2027', { title: 'Dentist', due: '2027-10-20' }],
  ['Dentist 20 Oct', { title: 'Dentist', due: '2026-10-20' }],
  ['Dentist 10/20', { title: 'Dentist', due: '2026-10-20' }, { dayFirst: false }],
  ['Dentist 11/02', { title: 'Dentist', due: '2026-11-02' }, { dayFirst: false }],
  ['Dentist 2026-12-01', { title: 'Dentist', due: '2026-12-01' }],
  ['Renew in 3 days', { title: 'Renew', due: '2026-10-18' }],
  ['Renew in two weeks', { title: 'Renew', due: '2026-10-29' }],
  ['Clean this weekend', { title: 'Clean', due: '2026-10-17' }],
  ['Plan next week', { title: 'Plan', due: '2026-10-19' }],
  ['Plan next month', { title: 'Plan', due: '2026-11-01' }],
  // ---- times
  ['Ligar amanhã 9h', { title: 'Ligar', due: '2026-10-16T09:00' }],
  ['Ligar amanhã às 9h30', { title: 'Ligar', due: '2026-10-16T09:30' }],
  ['Ligar às 14', { title: 'Ligar', due: '2026-10-15T14:00' }],
  ['Ligar 14:00', { title: 'Ligar', due: '2026-10-15T14:00' }],
  ['Almoço ao meio-dia', { title: 'Almoço', due: '2026-10-15T12:00' }],
  ['Jantar sexta à noite', { title: 'Jantar', due: '2026-10-16T19:00' }],
  ['Correr amanhã de manhã', { title: 'Correr', due: '2026-10-16T09:00' }],
  ['Call tomorrow 9am', { title: 'Call', due: '2026-10-16T09:00' }],
  ['Call tomorrow at 2:30pm', { title: 'Call', due: '2026-10-16T14:30' }],
  ['Call at 14', { title: 'Call', due: '2026-10-15T14:00' }],
  ['Lunch at noon', { title: 'Lunch', due: '2026-10-15T12:00' }],
  ['Movie tonight', { title: 'Movie', due: '2026-10-15T19:00' }],
  ['Movie tonight at 9pm', { title: 'Movie', due: '2026-10-15T21:00' }],
  ['Release 12am', { title: 'Release', due: '2026-10-15T00:00' }],
  // ---- recurrence
  ['Regar plantas todo dia', { title: 'Regar plantas', due: '2026-10-15', rule: 'FREQ=DAILY', from: 'due' }],
  ['Regar plantas todos os dias 8h', { title: 'Regar plantas', due: '2026-10-15T08:00', rule: 'FREQ=DAILY' }],
  ['Academia toda segunda', { title: 'Academia', due: '2026-10-19', rule: 'FREQ=WEEKLY;BYDAY=MO' }],
  ['Academia toda seg e qua', { title: 'Academia', due: '2026-10-19', rule: 'FREQ=WEEKLY;BYDAY=MO,WE' }],
  ['Academia todas as terças e quintas 7h', { title: 'Academia', due: '2026-10-15T07:00', rule: 'FREQ=WEEKLY;BYDAY=TU,TH' }],
  ['Relatório dias úteis', { title: 'Relatório', due: '2026-10-15', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }],
  ['Backup a cada 2 semanas', { title: 'Backup', due: '2026-10-15', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['Pagar cartão todo dia 5', { title: 'Pagar cartão', due: '2026-11-05', rule: 'FREQ=MONTHLY;BYMONTHDAY=5' }],
  ['Pagar condomínio todo mês', { title: 'Pagar condomínio', due: '2026-10-15', rule: 'FREQ=MONTHLY' }],
  ['Aniversário todo ano 20/10', { title: 'Aniversário', due: '2026-10-20', rule: 'FREQ=YEARLY' }],
  ['Cortar cabelo todo! mês', { title: 'Cortar cabelo', rule: 'FREQ=MONTHLY', from: 'completion' }],
  ['Cortar cabelo a cada! 3 semanas', { title: 'Cortar cabelo', rule: 'FREQ=WEEKLY;INTERVAL=3', from: 'completion' }],
  ['Water plants every day', { title: 'Water plants', due: '2026-10-15', rule: 'FREQ=DAILY' }],
  ['Gym every monday', { title: 'Gym', due: '2026-10-19', rule: 'FREQ=WEEKLY;BYDAY=MO' }],
  ['Gym every mon, wed', { title: 'Gym', due: '2026-10-19', rule: 'FREQ=WEEKLY;BYDAY=MO,WE' }],
  ['Standup every weekday 9:30', { title: 'Standup', due: '2026-10-15T09:30', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }],
  ['Backup every 2 weeks', { title: 'Backup', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['Pay card every 5th', { title: 'Pay card', due: '2026-11-05', rule: 'FREQ=MONTHLY;BYMONTHDAY=5' }],
  ['Rent monthly', { title: 'Rent', rule: 'FREQ=MONTHLY' }],
  ['Taxes yearly', { title: 'Taxes', rule: 'FREQ=YEARLY' }],
  ['Haircut every! 4 weeks', { title: 'Haircut', rule: 'FREQ=WEEKLY;INTERVAL=4', from: 'completion' }],
  // every second one
  ['Pay rent every other month', { title: 'Pay rent', due: '2026-10-15', rule: 'FREQ=MONTHLY;INTERVAL=2' }],
  ['Run every other day 7am', { title: 'Run', due: '2026-10-15T07:00', rule: 'FREQ=DAILY;INTERVAL=2' }],
  ['Team lunch every other friday', { title: 'Team lunch', due: '2026-10-16', rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR' }],
  ['Water ferns every! other week', { title: 'Water ferns', rule: 'FREQ=WEEKLY;INTERVAL=2', from: 'completion' }],
  ['Correr dia sim dia não', { title: 'Correr', due: '2026-10-15', rule: 'FREQ=DAILY;INTERVAL=2' }],
  ['Correr todo dia sim, dia não 6h', { title: 'Correr', due: '2026-10-15T06:00', rule: 'FREQ=DAILY;INTERVAL=2' }],
  ['Feira semana sim, semana não', { title: 'Feira', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['Ligar pra mãe quinzenalmente', { title: 'Ligar pra mãe', due: '2026-10-15', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['Reunião de equipe toda quinzena', { title: 'Reunião de equipe', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['Payroll biweekly', { title: 'Payroll', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  ['Clean filters fortnightly', { title: 'Clean filters', rule: 'FREQ=WEEKLY;INTERVAL=2' }],
  // a repeat in one word gives way to one said in full, and stays in the title
  ['Weekly review every friday p2', { title: 'Weekly review', due: '2026-10-16', rule: 'FREQ=WEEKLY;BYDAY=FR', priority: 2 }],
  ['Daily standup every weekday 9:30', { title: 'Daily standup', due: '2026-10-15T09:30', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }],
  ['Relatório mensal todo dia 5', { title: 'Relatório mensal', due: '2026-11-05', rule: 'FREQ=MONTHLY;BYMONTHDAY=5' }],
  ['Weekly review', { title: 'review', due: '2026-10-15', rule: 'FREQ=WEEKLY' }],
  // ---- priority, project, labels
  ['Pagar boleto p1', { title: 'Pagar boleto', priority: 1 }],
  ['Pagar boleto P3', { title: 'Pagar boleto', priority: 3 }],
  ['Pagar boleto #Casa', { title: 'Pagar boleto', project: 'Casa' }],
  ['Pagar boleto #casa', { title: 'Pagar boleto', project: 'Casa' }, { projects: ['Casa'] }],
  ['Comprar #Vida Pessoal leite', { title: 'Comprar leite', project: 'Vida Pessoal' }, { projects: ['Vida', 'Vida Pessoal'] }],
  ['Ligar @telefone @rua', { title: 'Ligar', labels: ['telefone', 'rua'] }],
  ['Mandar email para ana@exemplo.com', { title: 'Mandar email para ana@exemplo.com', labels: [] }],
  ['Item #1 da lista', { title: 'Item da lista', project: '1' }],
  [
    'Pagar aluguel amanhã 9h p1 #Casa @contas',
    { title: 'Pagar aluguel', due: '2026-10-16T09:00', priority: 1, project: 'Casa', labels: ['contas'] }
  ],
  // ---- reminders
  ['Consulta amanhã 15h lembrar 8h', { title: 'Consulta', due: '2026-10-16T15:00', remind: '2026-10-16T08:00' }],
  ['Consulta amanhã 15h lembrar 30 min antes', { title: 'Consulta', due: '2026-10-16T15:00', remind: '2026-10-16T14:30' }],
  ['Meeting tomorrow 9am remind me 2 hours before', { title: 'Meeting', due: '2026-10-16T09:00', remind: '2026-10-16T07:00' }],
  ['Meeting tomorrow 00:30 remind 1h before', { title: 'Meeting', due: '2026-10-16T00:30', remind: '2026-10-15T23:30' }],
  ['Buy milk remind at 6pm', { title: 'Buy milk', due: null, remind: '2026-10-15T18:00' }],
  // Relative to nothing: left as it was typed.
  ['Buy milk remind 30 min before', { title: 'Buy milk remind 30 min before', remind: null }],
  // ---- things that are not what they look like
  ['Comprar 2 pães', { title: 'Comprar 2 pães', due: null }],
  ['Ter que ligar', { title: 'Ter que ligar', due: null }],
  ['Set 5 alarms', { title: 'Set 5 alarms', due: null }],
  ['Sat on the couch', { title: 'Sat on the couch', due: null }],
  ['Versão 2.0', { title: 'Versão 2.0', due: null }],
  ['Dentista 31/02', { title: 'Dentista 31/02', due: null }],
  ['Only the first date: hoje amanhã', { title: 'Only the first date: amanhã', due: '2026-10-15' }],
  ['', { title: '', due: null, priority: null, project: null, labels: [] }]
]

export function defineParseSuite(zone: string): void {
  describe(`quick-add parser (${zone})`, () => {
    for (const [text, expected, options] of CASES) {
      it(JSON.stringify(text), () => {
        const result = parseTask(text, { now: NOW(), ...options })
        const { rule, from, ...fields } = expected
        expect(result).toMatchObject(fields)
        if (rule !== undefined) expect(result.recurrence?.rule ?? null).toBe(rule)
        if (from !== undefined) expect(result.recurrence?.from).toBe(from)
        // Every token is a slice of the text, in order, without overlaps.
        let end = 0
        for (const token of result.tokens) {
          expect(token.start).toBeGreaterThanOrEqual(end)
          expect(text.slice(token.start, token.end)).toBe(token.text)
          end = token.end
        }
      })
    }

    it('reports the spans it recognised, for highlighting', () => {
      const result = parseTask('Pagar aluguel amanhã 9h p1 #Casa @contas', { now: NOW() })
      expect(result.tokens.map((token) => [token.kind, token.text])).toEqual([
        ['date', 'amanhã'],
        ['time', '9h'],
        ['priority', 'p1'],
        ['project', '#Casa'],
        ['label', '@contas']
      ])
    })

    it('leaves an un-recognised span as typed, and lets nothing else take it', () => {
      const text = 'Comprar tinta de segunda mão'
      const first = parseTask(text, { now: NOW() })
      expect(first.due).toBe('2026-10-19')
      const segunda = first.tokens.find((token) => token.kind === 'date')!
      const second = parseTask(text, { now: NOW(), ignored: [{ start: segunda.start, text: segunda.text }] })
      expect(second).toMatchObject({ title: text, due: null, tokens: [] })
      // A stale entry (the text moved) is ignored.
      expect(parseTask(`Já ${text}`, { now: NOW(), ignored: [{ start: segunda.start, text: segunda.text }] }).due).toBe('2026-10-19')
    })

    it('keeps the recurrence words for display', () => {
      expect(parseTask('Academia toda seg e qua 7h', { now: NOW() }).recurrence).toEqual({
        rule: 'FREQ=WEEKLY;BYDAY=MO,WE',
        from: 'due',
        text: 'toda seg e qua'
      })
    })

    it('counts days on the calendar across month and year ends', () => {
      expect(parseTask('x em 20 dias', { now: new Date(2026, 11, 20, 23, 30) }).due).toBe('2027-01-09')
      expect(parseTask('x em 1 mês', { now: new Date(2027, 0, 31, 8, 0) }).due).toBe('2027-02-28')
      expect(parseTask('x dia 31', { now: new Date(2026, 10, 5, 8, 0) }).due).toBe('2026-12-31')
      expect(parseTask('x amanhã', { now: new Date(2026, 1, 28, 23, 59) }).due).toBe('2026-03-01')
    })
  })
}
