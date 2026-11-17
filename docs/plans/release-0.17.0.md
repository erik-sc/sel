# Release 0.17.0 — the tasks in Google Calendar, signed in

Status: **proposed** · 2026-11-17 · branch `release/0.17.0` (on top of `release/0.16.0`)

Érik, 2026-11-17: what he wanted from the start was for sel to sign in to Google and create the
tasks in Google's own calendar. The calendar by address of 0.15.0 needs a computer reachable from
outside and is read by Google only a few times a day; this needs neither.

## What it does

- sel signs in to Google as a desktop app (RFC 8252: the browser, a loopback address on
  127.0.0.1, PKCE) and asks for one permission, `calendar.app.created`: it makes a calendar of its
  own, **sel**, and can see and change only the calendars it made.
- Each open task with a date is an event there (`main/google/events.ts`): the whole day, or half
  an hour from its hour; a series for what repeats by its date. The event's id is the task's own,
  so the same task is the same event whichever computer sends it.
- One way. Every minute sel compares the tasks with what it last sent (a mark of what each event
  says, kept on this computer) and talks to Google only about what changed: a changed task is
  put again, one done, deleted or without a date is removed. Nothing changed, nothing asked.
- The calendar deleted in Google is made again; a sign-in Google no longer takes signs sel out
  and says so.
- What is private from the AI stays out, as in the calendar by address (the same list of tasks).

## What it needs from him

Google signs in only apps registered with it, and sel has no client of its own: he makes an OAuth
client in Google Cloud (type "Desktop app", app published "In production" so that the sign-in
does not end every week) and pastes its id and secret in Settings → Today → **Tasks in Google
Calendar**. docs/google-calendar.md walks through it.

## Where things are kept

The client secret and the refresh token are credentials: one file under the profile directory,
encrypted with the operating system's key store (`safeStorage`), never in the database or the
settings (which sync and export), never logged, never given to a window. Where there is no key
store the feature is not offered. Channels: `google:*` (status, configure, signIn, signOut,
sync).

## Limits, said in the guide

- Kept up to date while sel is open on the computer that signed in. One computer: each one that
  signs in makes its own calendar.
- Not over MCP: signing in is a browser on that computer.

## Checked

- Unit tests against a stand-in for Google: the sign-in through a real loopback server (the
  state is checked, one answer, refusal, nobody coming), the calendar made, only what changed
  sent, done tasks removed, a new token when the old ran out, the calendar made again, signed
  out by Google, errors said in words, the secret never in a status, a log or plain on disk.
- The settings group, by its tests; on this Linux machine (no key store) the built app shows
  "Not on this computer", as designed.
- **Not checked: Google itself.** No sign-in was made against Google's servers, since that needs
  his client. The first real sign-in is the test.
