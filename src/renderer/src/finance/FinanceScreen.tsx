// The Finance screen ("Meu mês"): the user's own month, added up by the main process
// (shared/finance/calc.ts) and drawn here. What should be left at the end of the month first,
// then where that comes from: accounts, income, fixed bills, cards, the day-to-day budget, the
// boxes. Whatever is entered goes through the block's tools, the same Claude uses on the phone.
// Loaded on demand through Host.tsx.
import { useId, useState } from 'react'
import type { JSX } from 'react'
import { FINANCE_PAGE_ID } from '@shared/finance'
import type { BillView, CardView, EntryView, FinanceMonthView } from '@shared/finance/api'
import type { HomeLocale } from '@/home/copy'
import { useHome } from '@/home/store'
import { openPage } from '@/store/tabs'
import { Button } from '@/ui/Button'
import { FINANCE_COPY, type FinanceCopy } from './copy'
import { ToolForm } from './Form'
import { dayName, type FieldSpec, Meter, money, monthName, MonthNav, runTool, Section, thisMonth, useMonthData } from './kit'
import './finance.css'

const load = (month: string): Promise<FinanceMonthView> => window.api.finance.month(month)

function Bills({
  lines,
  income,
  month,
  copy,
  locale
}: {
  lines: BillView[]
  income: boolean
  month: string
  copy: FinanceCopy
  locale: HomeLocale
}): JSX.Element {
  return (
    <ul className="fin-rows">
      {lines.map((line) => {
        const when = line.done
          ? (income ? copy.received : copy.paid)(dayName(line.doneOn ?? line.due ?? `${month}-01`, locale))
          : (income ? copy.expectedOn : copy.due)(line.due ? dayName(line.due, locale) : null)
        return (
          <li key={line.id} className={line.done ? 'fin-row is-done' : 'fin-row'}>
            <span className="fin-row-main">
              <span className="fin-row-title">{line.name}</span>
              <span className="fin-row-note">
                {when}
                {line.late && !income ? ` · ${copy.late}` : ''}
              </span>
            </span>
            <span className="fin-money">{money(line.amount)}</span>
            {!line.done && (
              <Button onClick={() => void runTool('finance_pay', { name: line.id, month }, copy.saveFailed)}>
                {income ? copy.receive : copy.pay}
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function EntryRow({
  entry,
  copy,
  locale,
  note
}: {
  entry: EntryView
  copy: FinanceCopy
  locale: HomeLocale
  note?: string
}): JSX.Element {
  // What a card gives back is not income: it takes from its invoice.
  const refund = entry.kind === 'income' && entry.invoice !== null
  const notes = [dayName(entry.date, locale), refund ? copy.refund : copy.kinds[entry.kind]]
  if (entry.category) notes.push(entry.category)
  if (entry.account) notes.push(entry.to ? `${entry.account} → ${entry.to}` : entry.account)
  if (entry.invoice) notes.push(copy.onInvoice(monthName(entry.invoice, locale)))
  if (entry.instalment) notes.push(copy.instalment(entry.instalment))
  if (note) notes.push(note)
  else if (entry.mine !== null) notes.push(copy.shared(money(entry.mine)))
  if (entry.planned) notes.push(copy.planned)
  return (
    <li className="fin-row">
      <span className="fin-row-main">
        <span className="fin-row-title">{entry.description}</span>
        <span className="fin-row-note">{notes.join(' · ')}</span>
      </span>
      <span className={entry.kind === 'income' ? 'fin-money is-in' : 'fin-money'}>{money(entry.amount)}</span>
      <button
        type="button"
        className="fin-remove"
        aria-label={copy.remove(entry.description)}
        title={copy.remove(entry.description)}
        onClick={() => void runTool('finance_delete', { id: entry.id }, copy.saveFailed, copy.removed)}
      >
        ×
      </button>
    </li>
  )
}

/** A card's invoice of the month: its total, and, opened, what is on it. Card purchases are kept apart from what left the accounts. */
function CardInvoice({ card, copy, locale }: { card: CardView; copy: FinanceCopy; locale: HomeLocale }): JSX.Element {
  return (
    <details className="fin-card">
      <summary className="fin-row">
        <span className="fin-row-main">
          <span className="fin-row-title">{card.card}</span>
          <span className="fin-row-note">
            {[
              copy.invoice(monthName(card.invoice, locale)),
              card.paid ? copy.invoicePaid : card.due ? copy.invoiceDue(dayName(card.due, locale)) : null,
              copy.nextInvoice(monthName(card.next.invoice, locale), money(card.next.total))
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="fin-money">{money(card.total)}</span>
      </summary>
      {card.entries.length ? (
        <ul className="fin-rows fin-card-entries">
          {card.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} copy={copy} locale={locale} />
          ))}
        </ul>
      ) : (
        <p className="fin-hint">{copy.invoiceEmpty}</p>
      )}
    </details>
  )
}

const NO_ACCOUNT = '\u0000none'

/** The month's entries, all together or those of one account or card. */
function Entries({ data, copy, locale }: { data: FinanceMonthView; copy: FinanceCopy; locale: HomeLocale }): JSX.Element {
  const [only, setOnly] = useState<string | null>(null)
  const used = new Set(data.entries.map((entry) => entry.account ?? NO_ACCOUNT))
  const choices = [
    ...data.accountNames.filter((name) => used.has(name)),
    ...[...used].filter((name) => name !== NO_ACCOUNT && !data.accountNames.includes(name))
  ]
  if (used.has(NO_ACCOUNT)) choices.push(NO_ACCOUNT)
  // A filter that the month no longer has (another month, an entry removed) shows everything.
  const picked = only !== null && used.has(only) ? only : null
  const shown = picked === null ? data.entries : data.entries.filter((entry) => (entry.account ?? NO_ACCOUNT) === picked)
  return (
    <>
      {choices.length > 1 && (
        <div className="fin-filter" role="group" aria-label={copy.filter}>
          {[null, ...choices].map((choice) => (
            <button
              key={choice ?? 'all'}
              type="button"
              className={choice === picked ? 'fin-chip is-on' : 'fin-chip'}
              aria-pressed={choice === picked}
              onClick={() => setOnly(choice)}
            >
              {choice === null ? copy.everything : choice === NO_ACCOUNT ? copy.noAccount : choice}
            </button>
          ))}
        </div>
      )}
      {shown.length ? (
        <ul className="fin-rows">
          {shown.map((entry) => (
            <EntryRow key={entry.id} entry={entry} copy={copy} locale={locale} />
          ))}
        </ul>
      ) : (
        <p className="fin-hint">{copy.nothingHere}</p>
      )}
    </>
  )
}

type SetupKind = 'account' | 'recurring' | 'budget' | 'box'

const SETUP_TOOL: Record<SetupKind, string> = {
  account: 'finance_account',
  recurring: 'finance_recurring',
  budget: 'finance_budget',
  box: 'finance_box'
}

function setupFields(kind: SetupKind, copy: FinanceCopy, data: FinanceMonthView): FieldSpec[] {
  const f = copy.setupFields
  switch (kind) {
    case 'account':
      return [
        { name: 'name', label: f.name, kind: 'text', required: true, suggestions: data.accountNames },
        {
          name: 'type',
          label: f.type,
          kind: 'choice',
          options: (['checking', 'card', 'cash'] as const).map((value) => ({ value, label: copy.accountTypes[value] }))
        },
        { name: 'balance', label: f.balance, kind: 'amount' },
        { name: 'closing_day', label: f.closingDay, kind: 'day' },
        { name: 'due_day', label: f.dueDay, kind: 'day' }
      ]
    case 'recurring':
      return [
        { name: 'name', label: f.name, kind: 'text', required: true },
        { name: 'amount', label: copy.fields.amount, kind: 'amount' },
        {
          name: 'kind',
          label: f.kind,
          kind: 'choice',
          options: (['expense', 'income'] as const).map((value) => ({ value, label: copy.recurringKinds[value] }))
        },
        { name: 'day', label: f.day, kind: 'day' },
        { name: 'category', label: copy.fields.category, kind: 'text', suggestions: data.categories },
        { name: 'account', label: copy.fields.account, kind: 'text', suggestions: data.accountNames }
      ]
    case 'budget':
      return [
        { name: 'category', label: copy.fields.category, kind: 'text', required: true, suggestions: data.categories },
        { name: 'limit', label: f.limit, kind: 'amount', required: true }
      ]
    case 'box':
      return [
        { name: 'name', label: f.name, kind: 'text', required: true, suggestions: data.boxNames },
        { name: 'balance', label: f.balance, kind: 'amount' },
        { name: 'goal', label: f.goal, kind: 'amount' },
        { name: 'purpose', label: f.purpose, kind: 'text' }
      ]
  }
}

const SETUP_INITIAL: Record<SetupKind, Record<string, string>> = {
  account: { type: 'checking' },
  recurring: { kind: 'expense' },
  budget: {},
  box: {}
}

function Setup({ copy, data, open }: { copy: FinanceCopy; data: FinanceMonthView; open: boolean }): JSX.Element {
  const [kind, setKind] = useState<SetupKind>('account')
  const id = useId()
  return (
    <details className="fin-setup" open={open}>
      <summary>{copy.setup}</summary>
      <label className="fin-field" htmlFor={id}>
        <span className="fin-field-label">{copy.setupWhat}</span>
        <select id={id} className="ui-input" value={kind} onChange={(event) => setKind(event.target.value as SetupKind)}>
          {(Object.keys(SETUP_TOOL) as SetupKind[]).map((each) => (
            <option key={each} value={each}>
              {copy.setupKinds[each]}
            </option>
          ))}
        </select>
      </label>
      {/* A form of its own for each kind: changing the kind starts from empty fields. */}
      <ToolForm
        key={kind}
        tool={SETUP_TOOL[kind]}
        fields={setupFields(kind, copy, data)}
        initial={SETUP_INITIAL[kind]}
        submit={copy.save}
        failed={copy.saveFailed}
        done={copy.saved}
      />
      <p className="fin-hint">{copy.setupHint}</p>
      {!data.empty && (
        <p className="fin-hint fin-raw">
          {copy.rawDataHint}{' '}
          <button type="button" className="fin-link" onClick={() => openPage(FINANCE_PAGE_ID)}>
            {copy.rawData}
          </button>
        </p>
      )}
    </details>
  )
}

export function FinanceScreen({ now }: { now?: Date }): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = FINANCE_COPY[locale]
  const [month, setMonth] = useState(() => thisMonth(now))
  const { data, failed } = useMonthData(load, month)

  const entryFields: FieldSpec[] = [
    { name: 'description', label: copy.fields.description, kind: 'text', required: true },
    { name: 'amount', label: copy.fields.amount, kind: 'amount', required: true },
    {
      name: 'kind',
      label: copy.fields.kind,
      kind: 'choice',
      options: (['expense', 'income', 'transfer'] as const).map((value) => ({ value, label: copy.kinds[value] }))
    },
    { name: 'date', label: copy.fields.date, kind: 'date' },
    { name: 'category', label: copy.fields.category, kind: 'text', suggestions: data?.categories },
    { name: 'account', label: copy.fields.account, kind: 'text', suggestions: data?.accountNames },
    { name: 'to', label: copy.fields.to, kind: 'text', suggestions: [...(data?.accountNames ?? []), ...(data?.boxNames ?? [])] }
  ]

  return (
    <div className="fin">
      <header className="fin-head">
        <p className="fin-kicker">{copy.kicker}</p>
        <h1 className="fin-title">{copy.title}</h1>
        <p className="fin-lede">{copy.lede}</p>
        <MonthNav month={month} locale={locale} onChange={setMonth} labels={copy.nav} />
      </header>

      {!data ? (
        <p className="fin-hint" role="status">
          {failed ? copy.failed : copy.loading}
        </p>
      ) : (
        <>
          {data.empty ? (
            <div className="fin-callout">
              <p className="fin-callout-title">{copy.emptyTitle}</p>
              <p className="fin-hint">{copy.emptyText}</p>
            </div>
          ) : (
            <div className="fin-callout">
              <p className="fin-callout-label">{copy.free}</p>
              <p className={data.freeAtEndOfMonth < 0 ? 'fin-callout-amount is-short' : 'fin-callout-amount'}>
                {money(data.freeAtEndOfMonth)}
              </p>
              <dl className="fin-stats">
                <div>
                  <dt>{copy.inAccounts}</dt>
                  <dd>{money(data.inAccounts)}</dd>
                </div>
                <div>
                  <dt>{copy.expected}</dt>
                  <dd>{money(data.income.expected)}</dd>
                </div>
                <div>
                  <dt>{copy.toPay}</dt>
                  <dd>{money(data.bills.pending)}</dd>
                </div>
              </dl>
              <p className="fin-hint">{copy.freeHint}</p>
            </div>
          )}

          <Section title={copy.add}>
            <ToolForm
              tool="finance_add"
              fields={entryFields}
              initial={{ kind: 'expense' }}
              keep={['kind', 'date', 'account']}
              submit={copy.add}
              failed={copy.addFailed}
              done={copy.added}
            />
          </Section>

          {data.accounts.length > 0 && (
            <Section title={copy.accounts} aside={<span className="fin-money">{money(data.inAccounts)}</span>}>
              <ul className="fin-rows">
                {data.accounts.map((account) => (
                  <li key={account.name} className="fin-row">
                    <span className="fin-row-main">
                      <span className="fin-row-title">{account.name}</span>
                      <span className="fin-row-note">{copy.accountTypes[account.type]}</span>
                    </span>
                    <span className="fin-money">{money(account.balance)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.income.lines.length > 0 && (
            <Section title={copy.income} aside={<span className="fin-money">{money(data.income.received + data.income.expected)}</span>}>
              <Bills lines={data.income.lines} income month={month} copy={copy} locale={locale} />
            </Section>
          )}

          {data.bills.lines.length > 0 && (
            <Section title={copy.bills} aside={<span className="fin-money">{money(data.bills.paid + data.bills.pending)}</span>}>
              <Bills lines={data.bills.lines} income={false} month={month} copy={copy} locale={locale} />
            </Section>
          )}

          {data.cards.length > 0 && (
            <Section title={copy.cards}>
              {data.cards.map((card) => (
                <CardInvoice key={card.card} card={card} copy={copy} locale={locale} />
              ))}
            </Section>
          )}

          {data.budget.categories.length > 0 && (
            <Section
              title={copy.budget}
              aside={<span className="fin-money">{copy.budgetLine(money(data.budget.spent), money(data.budget.limit))}</span>}
            >
              <ul className="fin-rows">
                {data.budget.categories.map((line) => (
                  <li key={line.category} className="fin-row is-meter">
                    <span className="fin-row-main">
                      <span className="fin-row-title">{line.category}</span>
                      <span className="fin-row-note">
                        {line.limit === null
                          ? copy.noLimit
                          : (line.left ?? 0) >= 0
                            ? copy.left(money(line.left ?? 0))
                            : copy.over(money(-(line.left ?? 0)))}
                      </span>
                    </span>
                    {line.limit !== null && (
                      <Meter value={line.spent} max={line.limit} label={copy.meter(line.category, money(line.spent), money(line.limit))} />
                    )}
                    <span className="fin-money">
                      {line.limit === null ? money(line.spent) : copy.budgetLine(money(line.spent), money(line.limit))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="fin-hint">
                {copy.budgetLeft(
                  money(data.budget.left),
                  data.budget.daysLeft,
                  data.budget.perWeek === null ? null : money(data.budget.perWeek)
                )}
              </p>
            </Section>
          )}

          {data.boxes.length > 0 && (
            <Section title={copy.boxes} aside={<span className="fin-money">{money(data.inBoxes)}</span>}>
              <ul className="fin-rows">
                {data.boxes.map((box) => (
                  <li key={box.name} className="fin-row is-meter">
                    <span className="fin-row-main">
                      <span className="fin-row-title">{box.name}</span>
                      {box.purpose && <span className="fin-row-note">{box.purpose}</span>}
                    </span>
                    {box.goal !== null && box.goal > 0 && (
                      <Meter value={box.balance} max={box.goal} label={copy.meter(box.name, money(box.balance), money(box.goal))} />
                    )}
                    <span className="fin-money">
                      {money(box.balance)}
                      {box.goal !== null && box.goal > 0 ? ` ${copy.boxGoal(money(box.goal))}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {data.owed.length > 0 && (
            <Section title={copy.owed}>
              <ul className="fin-rows">
                {data.owed.map((each) => (
                  <li key={each.person} className="fin-row">
                    <span className="fin-row-title">
                      {each.amount > 0 ? copy.owesYou(each.person, money(each.amount)) : copy.youOwe(each.person, money(-each.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {!data.empty && (
            <Section
              title={`${copy.next}: ${monthName(data.nextMonth.month, locale)}`}
              aside={<span className="fin-money">{copy.nextFree(money(data.nextMonth.free))}</span>}
            >
              <p className="fin-hint">
                {copy.nextLine(
                  money(data.nextMonth.income),
                  money(data.nextMonth.bills),
                  money(data.nextMonth.budget),
                  money(data.nextMonth.invoices)
                )}
              </p>
            </Section>
          )}

          {!data.empty && (
            <Section title={copy.entries}>
              {data.entries.length ? <Entries data={data} copy={copy} locale={locale} /> : <p className="fin-hint">{copy.noEntries}</p>}
            </Section>
          )}

          <Setup copy={copy} data={data} open={data.empty} />
        </>
      )}
    </div>
  )
}
