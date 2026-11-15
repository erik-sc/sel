# Release 0.15.1 — the tasks' calendar, turned on from a conversation

Status: **proposed** · 2026-11-15 · branch `release/0.15.1`

Érik, 2026-11-15: the tasks' calendar of 0.15.0 is published by the computer the MCP server
runs on, and its switch is in that computer's Settings. His server is another machine than the
one he sits at.

- `tasks_calendar` (MCP, scope tasks): `status`, `on`, `off`, `new_address`. The same setting as
  Settings → Today → "Tasks in other calendars" (`tasks.feed`), written on the computer that
  answers. It gives the address to paste in Google Calendar and on the iPhone, made from the
  address the remote connector is reached at; without one it says what to turn on.
- The Release workflow no longer publishes a release pull request that was merged inside
  another: #128 (0.14.0), closed as merged with #129 (0.15.0), published 0.14.0 after 0.15.0 and
  became "the latest" until it was fixed by hand. A pull request whose version is not main's now
  stops with that said.

## Checked

- Unit tests: the tool against a running server (the address it gives answers; a new address
  closes the old one; off closes it).
- Not checked: a real subscription in Google Calendar or on an iPhone.
