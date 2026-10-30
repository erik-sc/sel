# Release 0.11.0 — From anywhere, and calmer

Status: **closing** · 2026-10-30 · branch `release/0.11.0`

Two things in this release: sel answers Claude from anywhere (the phone, claude.ai, Claude Code on
other machines), and the first round of the design proposal "sel — como pode melhorar" made in the
canvas on 2026-10-30.

## From anywhere (#122)

The remote MCP connector: a server inside the app (off by default, 127.0.0.1 only), OAuth 2.1 with
sign-in through GitHub's device flow and sel's own GitHub app (nothing to set up on GitHub), a
consent screen with scopes (read, tasks, write pages), task tools (list, add with quick-add words,
complete, reschedule), pairing window for new apps, owner pinned by GitHub id. Phone use needs a
tunnel (Tailscale Funnel or Cloudflare Tunnel). See docs/remote-mcp.md.

## Design round 1

From the canvas, "Hoje" next to "Proposto":

- **Contrast (7):** the ink tokens rise to the measured proposal in Papel and Carvão: secondary and
  tertiary text, danger, success and the orange/red/blue tags pass 4.5:1 on every layer they fall on
  (sheet, sunk, current row, selected row, card in hover, active menu row); new `--border-control`
  (3:1) and `--text-disabled`; the primary button's focus ring sits 4px off its stamp.
  contrast.test.ts checks all of it, both themes.
- **Today (2):** completing a task is calm: the ring fills, the tick draws, the strike and the ink take
  300ms, and the row collapses 1.5s later; Undo and the checkbox reopen it until then. The toast names
  the task; Today's words are in Portuguese when the home is pt-BR.
- **Inbox (3):** empty chips outlined at 3:1; the key (D, 1–4, #) shown inside the chip on the row in
  focus; a task given a project leaves the Inbox with a 300ms fade and an Undo toast.
- **Database (4):** rename a column in its header (F2, double-click, or click it again); a type glyph
  opens only the type choice, warns before a conversion that would lose values, and every conversion
  has Undo; board cards keep their outline on hover.
- **Herman (6):** a note, not a chat: one observation, an effect line naming what changes, a verb and
  "Not now" (for the rest of the day); the Inbox note can date the waiting tasks for tomorrow, with
  Undo.

Not in this round: the night state after closing the day (5) is a product question for Érik; the
board "Levantar" keyboard lift; the out-of-round list on the canvas (palette, tabs, tooltip, skeleton,
forced-colors, targets under 24px, high-contrast preset, column layout).

Reviewed by an independent pass; its two blocking findings (the Inbox fade loop, Today's row
vanishing on the real data path) and five smaller ones are fixed with tests.

## Housekeeping

Dependabot: zustand, electron-updater/electron-builder, katex, Biome 2.6.3 (Markdown formatter off).
