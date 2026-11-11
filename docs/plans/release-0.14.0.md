# Release 0.14.0 — Claude on your phone, in one switch

Status: **proposed** · 2026-11-11 · branch `release/0.14.0`

Érik, 2026-11-11: the connector he was using dropped all the time and had to be restarted from a
terminal. That connector was not sel's: it was a set of scripts beside it (a gateway process, two
scheduled tasks, a tunnel pointed at the gateway), put together on 2026-11-10 before anyone
remembered that sel has had a remote connector of its own since 0.11.0. He asked for two things:
that the server start with sel on that machine, and that all of this be abstracted, with only the
essential in the app and the rest under advanced settings.

## What changes

**Settings → MCP opens with one switch: "Claude on your phone".** Turning it on:

1. keeps sel running in the notification area and starting with the computer (the server lives in
   sel);
2. starts the remote connector (it already started with sel when on);
3. opens the tunnel by itself: finds Tailscale, asks it for this computer's address, points its
   Funnel at the connector's port, and keeps that address as the public one;
4. shows the address to give Claude, and lets the first app in for ten minutes.

Each time sel starts it does 2 and 3 again, so the server and the way in are there with nothing
else to run. When something is missing the same row says which, and offers the one step: get
Tailscale, sign in to it, or allow Funnel for this computer (Tailscale asks once).

Below the switch: the address, "Let a new app in", and the apps connected. **Everything else is
under Advanced**, closed: the address typed by hand (for a tunnel of one's own), the port, the
GitHub account let in, Claude Code on other machines, the calls from outside, and the whole of
"Apps on this computer" (the token, the set-up snippets, its calls).

## How

- `src/main/remote/tunnel.ts`: the `tailscale` program by absolute path, no shell, a minimal
  environment, only four commands (`status --json`, `funnel --bg --https=443 http://127.0.0.1:<port>`,
  `funnel status --json`, `funnel --https=443 off`). What it prints is read as data: the address
  must be a host name, the approval page must be on login.tailscale.com.
- `RemoteConfig.tunnel`: `tailscale` (sel keeps it) or `manual` (the user's own, as before; what
  existing settings become).
- `mcp:phone(on)`: the switch. Turning it off closes the server and the tunnel sel opened, never
  one the user runs.

## Not in this release

- A tunnel other than Tailscale Funnel behind the switch (Cloudflare Tunnel stays by hand).
- Installing Tailscale or signing in to it from sel: the row links to it.
- Signing in without GitHub.

## Checks

`npm run typecheck`, `npm run lint`, `npx vitest run --dir src`: the four failures of the base
branch on Linux and Node 22 and no other. The built app was run with a stand-in `tailscale`: the
switch turned on from Settings opened the server and asked Tailscale for exactly the three
commands; after quitting and starting sel again the server answered and the tunnel was asked for
again, with nothing clicked. Not run: a real Tailscale, Windows, Claude connecting.
