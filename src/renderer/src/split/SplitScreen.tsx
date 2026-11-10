// The household screen ("Divisão de contas"): what the user shares with the one person they live
// with. Who owes whom first, over every month; then one month in numbers, its fixed bills to
// launch, its expenses and the payments between the two. It is a view of the Finance ledger
// (shared/finance/household.ts), written through the block's tools. Loaded on demand through
// Host.tsx.
import { useState } from 'react'
import type { JSX } from 'react'
import type { HouseholdView } from '@shared/finance/api'
import { FINANCE_COPY } from '@/finance/copy'
import { EntryRow } from '@/finance/FinanceScreen'
import { ToolForm } from '@/finance/Form'
import { dayName, type FieldSpec, Meter, money, monthName, MonthNav, runTool, Section, thisMonth, useMonthData } from '@/finance/kit'
import { useHome } from '@/home/store'
import { Button } from '@/ui/Button'
import { SPLIT_COPY, type SplitCopy } from './copy'
import '@/finance/finance.css'

const load = (month: string): Promise<HouseholdView> => window.api.finance.household(month)

function Balance({ data, copy }: { data: HouseholdView; copy: SplitCopy }): JSX.Element {
  const partner = data.household.partner
  const amount = Math.abs(data.balance)
  if (amount < 0.005)
    return (
      <div className="fin-callout">
        <p className="fin-callout-label">{copy.even}</p>
        <p className="fin-callout-amount">{money(0)}</p>
        <p className="fin-hint">{copy.evenHint(partner)}</p>
      </div>
    )
  return (
    <div className="fin-callout">
      <p className="fin-callout-label">{data.balance > 0 ? copy.theyOwe(partner) : copy.youOwe(partner)}</p>
      <p className="fin-callout-amount">{money(amount)}</p>
      <div className="fin-callout-actions">
        <Button variant="primary" onClick={() => void runTool('split_settle', {}, copy.settleFailed, copy.settled)}>
          {copy.settle(money(amount))}
        </Button>
      </div>
      <p className="fin-hint">{copy.allMonths}</p>
    </div>
  )
}

export function SplitScreen({ now }: { now?: Date }): JSX.Element {
  const locale = useHome((state) => state.locale)
  const copy = SPLIT_COPY[locale]
  const finance = FINANCE_COPY[locale]
  const [month, setMonth] = useState(() => thisMonth(now))
  const { data, failed, reload } = useMonthData(load, month)
  const partner = data?.household.partner ?? ''
  const mine = data?.household.myShare ?? 50

  const configFields: FieldSpec[] = [
    { name: 'partner', label: copy.partner, kind: 'text', required: true },
    { name: 'my_share', label: copy.myShare, kind: 'percent' }
  ]
  const who = [
    { value: 'me', label: copy.me },
    { value: 'partner', label: partner }
  ]
  const expenseFields: FieldSpec[] = [
    { name: 'description', label: copy.fields.description, kind: 'text', required: true },
    { name: 'amount', label: copy.fields.amount, kind: 'amount', required: true },
    { name: 'category', label: copy.fields.category, kind: 'text', suggestions: data?.categories },
    { name: 'date', label: copy.fields.date, kind: 'date' },
    { name: 'paid_by', label: copy.fields.paidBy, kind: 'choice', options: who },
    {
      name: 'how',
      label: copy.fields.how,
      kind: 'choice',
      options: (['default', 'mine', 'theirs', 'custom'] as const).map((value) => ({ value, label: copy.how[value](partner, mine) }))
    },
    { name: 'my_part', label: copy.fields.myPart, kind: 'amount' },
    { name: 'account', label: copy.fields.account, kind: 'text', suggestions: data?.accountNames }
  ]
  const billFields: FieldSpec[] = [
    { name: 'name', label: copy.billFields.name, kind: 'text', required: true },
    { name: 'amount', label: copy.billFields.amount, kind: 'amount' },
    { name: 'day', label: copy.billFields.day, kind: 'day' },
    { name: 'category', label: copy.fields.category, kind: 'text', suggestions: data?.categories },
    { name: 'paid_by', label: copy.fields.paidBy, kind: 'choice', options: who },
    { name: 'my_share', label: copy.billFields.myShare, kind: 'percent' }
  ]
  const top = data?.byCategory[0]?.amount ?? 0

  return (
    <div className="fin">
      <header className="fin-head">
        <p className="fin-kicker">{copy.kicker(partner)}</p>
        <h1 className="fin-title">{copy.title}</h1>
        <p className="fin-lede">{copy.lede}</p>
        {partner && <MonthNav month={month} locale={locale} onChange={setMonth} labels={copy.nav} />}
      </header>

      {!data ? (
        <p className="fin-hint" role="status">
          {failed ? copy.failed : copy.loading}
        </p>
      ) : !partner ? (
        <div className="fin-callout">
          <p className="fin-callout-title">{copy.setupTitle}</p>
          <p className="fin-hint">{copy.setupText}</p>
          <ToolForm
            tool="split_config"
            fields={configFields}
            initial={{ my_share: String(mine) }}
            submit={copy.start}
            failed={copy.saveFailed}
            onDone={reload}
          />
        </div>
      ) : (
        <>
          <Balance data={data} copy={copy} />

          <Section title={copy.add}>
            <ToolForm
              tool="split_add"
              fields={expenseFields}
              initial={{ paid_by: 'me', how: 'default' }}
              keep={['paid_by', 'date', 'account']}
              submit={copy.submit}
              failed={copy.addFailed}
              done={copy.added}
            />
            <p className="fin-hint">{copy.receiptHint}</p>
          </Section>

          <Section title={`${copy.month}: ${monthName(month, locale)}`}>
            <dl className="fin-stats is-wide">
              <div>
                <dt>{copy.total}</dt>
                <dd>{money(data.total)}</dd>
                <dd className="fin-stat-note">{copy.count(data.expenses.length)}</dd>
              </div>
              <div>
                <dt>{copy.part(copy.me)}</dt>
                <dd>{money(data.mine.share)}</dd>
                <dd className="fin-stat-note">{copy.paid(money(data.mine.paid))}</dd>
              </div>
              <div>
                <dt>{copy.part(partner)}</dt>
                <dd>{money(data.theirs.share)}</dd>
                <dd className="fin-stat-note">{copy.paid(money(data.theirs.paid))}</dd>
              </div>
            </dl>
          </Section>

          {data.byCategory.length > 0 && (
            <Section title={copy.byCategory}>
              <ul className="fin-rows">
                {data.byCategory.map((line) => (
                  <li key={line.category} className="fin-row is-meter">
                    <span className="fin-row-title">{line.category}</span>
                    <Meter value={line.amount} max={top} label={copy.meter(line.category, money(line.amount))} />
                    <span className="fin-money">{money(line.amount)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={copy.bills}>
            {data.bills.length ? (
              <ul className="fin-rows">
                {data.bills.map((bill) => (
                  <li key={bill.id} className={bill.launched ? 'fin-row is-done' : 'fin-row'}>
                    <span className="fin-row-main">
                      <span className="fin-row-title">{bill.name}</span>
                      <span className="fin-row-note">
                        {copy.billNote(copy.pays(bill.paidByMe ? copy.me : partner), bill.myShare, bill.day)}
                        {bill.launched ? ` · ${copy.launched(dayName(bill.launched.date, locale))}` : ''}
                      </span>
                    </span>
                    <span className="fin-money">{money(bill.launched?.amount ?? bill.amount)}</span>
                    {!bill.launched && (
                      <Button onClick={() => void runTool('split_launch', { name: bill.id, month }, copy.launchFailed)}>
                        {copy.launch}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fin-hint">{copy.noBills}</p>
            )}
            <details className="fin-setup">
              <summary>{copy.newBill}</summary>
              <ToolForm
                tool="split_bill"
                fields={billFields}
                initial={{ paid_by: 'me' }}
                submit={copy.save}
                failed={copy.saveFailed}
                done={copy.saved}
              />
            </details>
          </Section>

          <Section title={copy.expenses}>
            {data.expenses.length ? (
              <ul className="fin-rows">
                {data.expenses.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    copy={finance}
                    locale={locale}
                    note={`${copy.paidBy(entry.paidByMe ? copy.me : partner)} · ${copy.parts(money(entry.mine ?? 0), partner, money(entry.theirs ?? 0))}`}
                  />
                ))}
              </ul>
            ) : (
              <p className="fin-hint">{copy.noExpenses(monthName(month, locale))}</p>
            )}
          </Section>

          {data.settlements.length > 0 && (
            <Section title={copy.settlements}>
              <ul className="fin-rows">
                {data.settlements.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    copy={finance}
                    locale={locale}
                    note={copy.settlementLine(entry.paidByMe ? copy.me : partner, entry.paidByMe ? partner : copy.me)}
                  />
                ))}
              </ul>
            </Section>
          )}

          <details className="fin-setup">
            <summary>{copy.settings}</summary>
            <ToolForm
              key={`${partner}-${mine}`}
              tool="split_config"
              fields={[configFields[1]]}
              initial={{ my_share: String(mine) }}
              keep={['my_share']}
              submit={copy.save}
              failed={copy.saveFailed}
              done={copy.saved}
              onDone={reload}
            />
            <p className="fin-hint">{copy.settingsHint}</p>
          </details>
        </>
      )}
    </div>
  )
}
