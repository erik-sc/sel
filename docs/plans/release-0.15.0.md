# Release 0.15.0 — the card apart from the account, events, and quieter settings

Status: **proposed** · 2026-11-11 · branch `release/0.15.0` (on top of `release/0.14.0`)

Érik, 2026-11-11, after bringing his whole bank statement into Finanças:

1. it "is still odd, it is mixing credit and so on";
2. the calendar should let him create events (in Google Calendar);
3. the settings should be simpler in general (the essential first, the rest under a closed
   Advanced, as Settings → MCP became in 0.14.0; nothing removed);
4. the Finance databases should be hidden, as the Tasks database is.

His statement could not be read from here (the connector was down), so point 1 is answered by
what a statement brought in whole is known to get wrong, and by a tool that finds what is wrong in
the data itself.

## 1. Finanças: a statement brought in whole

What went wrong, and what changes:

- **Past entries moved today's balance.** A balance was moved by every entry *entered* after it was
  told, so a statement of past months entered today was subtracted from today's balance. Now a
  balance is moved by what *happened* after it was told: entries dated before that day are already
  in it (`after` in shared/finance/calc.ts). `finance_account` and `finance_box` take `as_of`, the
  day a balance is of, to walk a statement forward from its starting balance instead.
- **Card purchases entered before the card was a card fell on no invoice.** The invoice was
  stored only when the account was already registered as a card. Now a purchase without one gets
  the invoice its date gives when the books are read (`withInvoices`).
- **Refunds on a card counted as income.** What a card gives back now takes from its invoice and
  from what was spent in its category; it is not income. The screen calls it a refund.
- **An invoice payment in the account's statement counted twice** (the payment as an expense, and
  the purchases on the card). `finance_update` can now change an entry's `kind`: the payment
  becomes a transfer to the card, which also marks the invoice paid. A transfer to a card that
  names no invoice pays the one of the month it was made in. `finance_update` also takes
  `invoice`, for a purchase that belongs on another invoice than its date gives.
- **`finance_review`** (new, read-only): looks over the ledger and lists, with ids and the fix
  for each: invoice payments entered as expenses, payments entered on the card, entries with no
  account or on an account that is not registered, entries entered twice, expenses with no
  category, cards with no closing or due day. Meant to be run by Claude after a statement.
- **The screen keeps the two apart.** Each card's invoice opens to show what is on it; the month's
  entries can be shown one account or card at a time; a card purchase says which invoice it is on.

## 2. Calendar: new events

sel reads calendars by their private iCal address and cannot write to them. Writing through
Google's API needs an OAuth client registered with Google (a project in Google Cloud, by the
owner of the account), which this release does not have. What it does instead needs nothing:

- "New event" in the calendar's header, and an Event tab beside Task in the popover a click on a
  day or an hour opens: what, day, all day or from/until, where.
- "Create in Google Calendar" opens Google Calendar's own new-event page already filled in
  (briefing/newEvent.ts); he picks the calendar and saves there. The event shows in sel with the
  calendar's next refresh (the toast offers it).

Creating the event without leaving sel is a later release, once there is an OAuth client.

## 3. Settings: the essential, then Advanced

`ui/Advanced.tsx`: a closed disclosure at the end of a section. Nothing was removed.

| Section | Stays in sight | Under Advanced |
| --- | --- | --- |
| General | Theme, Updates, About | Pages, Data |
| Sidebar | Items | Restore the defaults |
| History | On/off, storage used | Pause, versions kept, space |
| AI | On/off, introduction and memory | Claude Code, context, tools, routines, usage, history (opens by itself when Claude Code is missing) |
| Herman | Persona, on/off, outfit, "say what he notices", briefing | Seasonal outfits, voice, size, corner, how often, quiet hours, what he learned |
| Notifications | Task reminders, calendar events | Refining, lead time and recording, sound and background |
| Sync | Status (and the whole set-up before it is connected) | Repository, recent activity, this device |
| Today | Calendars | Today, open tasks, phrase, closing the day, sky |
| Meetings | Transcription | Recording, storage |
| Pomodoro | Timer | Starting |
| MCP | (0.14.0) | (0.14.0), now on the shared component |

## 4. The Finance page is out of the sidebar

The page that holds the five databases no longer shows in the sidebar's tree
(renderer store/tree.ts), as the Tasks database does not. It is still a page: search finds it, and
"Open the databases" under the Finances screen's set-up opens it. Nothing is migrated.

## Checked

- Unit tests: the arithmetic (balances by date, derived invoices, refunds, payment by month), the
  tools (a statement sorted out end to end, `as_of`, `invoice`, `finance_review`), the screen
  (invoice opens, filter by account), the sidebar's root, `Advanced`, the new event's address and
  form.
- The built app, started on Linux with a statement entered the wrong way round (purchases before
  the card, the payment as an expense, a refund as income): balances, invoices and the review read
  as above; every section of Settings opens with Advanced closed; the calendar's new event form.
- Not checked: Windows, and his own data.
