# sel from anywhere: the remote MCP connector

Status: prototype. Off by default; nothing listens until you turn it on in Settings → MCP.

The notes stay on your main computer. sel runs a small server on that computer, and Claude on
your phone, claude.ai, Claude Desktop or Claude Code on another machine reach it through a
tunnel you run:

```
Claude (phone) → Anthropic's servers → https://your-tunnel → 127.0.0.1:47615 (sel) → the SQLite of your workspace
```

Claude's custom connectors are called from Anthropic's cloud, not from the phone. That is why
the address must be public https, and why a private tailnet alone is not enough. The computer
must be on, and sel must be running (keep it in the notification area: Settings → Notifications).

## What it can do

On the consent screen you choose what each connection gets:

| Access | Tools |
| --- | --- |
| Read | `list_tasks` (today with overdue, upcoming, inbox, all), `search`, `outline`, `read_page`, `read_database`, `recent`, `audit` |
| Tasks | `add_task` (quick-add words in Portuguese or English: `Pagar aluguel amanhã 9h p1 #Casa @contas`), `complete_task` (a repeating task moves on), `reschedule_task` |
| Write pages | `create_page`, `append_to_page`, `add_database_row`, `update_database_row` |

Nothing can be deleted. What you keep private from the AI is left out of every list and refused
by id. Every change goes through the same path as an edit in the window, so version history has
the state before it. Settings → MCP lists the signed-in apps (end any of them there) and the
latest calls (which tool and when, never what was asked).

## Setting it up

Nothing to create on GitHub: sel signs you in with its own GitHub app, through GitHub's device
flow (as `gh auth login` does). GitHub only tells sel who you are; sel gets no access to your
GitHub account and forgets GitHub's token at once.

### On this computer first (Claude Code, no tunnel)

1. sel → Settings → MCP → From anywhere → **On**. For the next 10 minutes a new app may connect.
2. In a terminal: `claude mcp add --transport http --scope user sel-remote http://127.0.0.1:47615/mcp` (Settings shows it with a copy button).
3. In Claude Code, `/mcp` → sel-remote → Authenticate. A browser page shows a code such as `ABCD-1234`: open GitHub, enter it, Authorize. The page goes on by itself to the consent screen; choose what to allow.

The first GitHub account that signs in becomes the owner, pinned by its numeric id; after that,
only it gets in. "End every connection" in Settings forgets it.

### For the phone: a tunnel

Claude's connectors are called from Anthropic's cloud, so the phone needs a public https address.
Pick one; sel listens on `127.0.0.1` only and the tunnel is the one way in.

**Tailscale Funnel** (no domain of your own needed)

1. Install Tailscale and sign in. In the admin console, enable HTTPS certificates and Funnel for the machine.
2. Run `tailscale funnel --bg 47615`.
3. Your public address is `https://<machine>.<tailnet>.ts.net` (`tailscale funnel status` shows it).

**Cloudflare Tunnel** (needs a domain on Cloudflare)

1. Install `cloudflared`, then run `cloudflared tunnel login`.
2. `cloudflared tunnel create sel` and `cloudflared tunnel route dns sel sel.yourdomain.com`.
3. `cloudflared tunnel run --url http://localhost:47615 sel` (or install it as a service so it starts with Windows).
4. Your public address is `https://sel.yourdomain.com`.

Then put the address in Settings → MCP → Public address, choose **Connect a new app → Allow for
10 minutes**, and on claude.ai: Settings → Connectors → Add custom connector → `<public address>/mcp`
→ Connect → the same GitHub code page → Allow. The connector then works in the Claude app on the
phone, on claude.ai and in Claude Desktop: it is one connection, kept by your Claude account.

Claude Code on another machine connects the same way, with the public address; each machine is
one more connection in Settings, ended on its own.

Only one computer should serve: the main one. The others reach it through sync.

### The GitHub app (maintainers)

sel's GitHub OAuth App is created once by the project, with **Enable Device Flow** on; its
client id (public: the device flow takes no secret) is `SEL_GITHUB_CLIENT_ID` in
src/main/remote/github.ts. The callback URL GitHub asks for is never used.

## How the sign-in works

sel is its own OAuth 2.1 authorization server, as Claude's connectors expect:

1. An unauthenticated call to `/mcp` gets `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
2. Claude reads the protected-resource and authorization-server metadata, registers itself (`/register`, dynamic client registration) and sends you to `/authorize` with PKCE (S256).
3. sel asks GitHub for a device code and shows it on `/oauth/device`, a page that reloads itself. You enter the code on github.com/login/device; sel, polling GitHub as often as GitHub allows, learns which account it was, checks it is the owner, and shows the consent screen.
4. On Allow, Claude gets a one-time code and trades it at `/token` for an access token (1 hour) and a refresh token (30 days, used once: each refresh gives a new one).

Safeguards:

- New apps can register only during the 10 minutes after you choose "Connect a new app"; the consent screen says when the app was connected to sel.
- The GitHub account is pinned by its numeric id the first time it signs in, so a renamed login someone else takes later is refused.
- Only Claude's own callback (`https://claude.ai/api/mcp/auth_callback`) and loopback addresses (Claude Code) can register; codes go nowhere else.
- The browser that started a sign-in carries a cookie the waiting page and the consent screen check, so a link someone else started cannot be finished in your browser.
- Tokens are stored as SHA-256 only (`remote-auth.json` next to the database, never in it). A refresh token used twice ends the whole connection, so a stolen copy is useless after its first use. A retry within a minute (a reply lost on the way) gets a new pair instead, and the previous access token stays valid until it expires, so calls in flight are not cut.
- Calls are rate-limited in separate buckets (tools, /token, the rest of the sign-in; unknown paths are not counted), and each app can have only a few sign-ins in flight; the consent screen cannot be framed.
- Turning the connector off closes the port; ending a connection in Settings stops its tokens at once.

## Not in this prototype

- Google sign-in (GitHub only for now).
- Meeting notes tools.
- Client ID metadata documents (CIMD); dynamic registration covers Claude today.
- Per-caller rate limits (behind a tunnel every caller looks like 127.0.0.1).
- A public address with a path (`https://host/sel`): sel answers at the root, so give it an origin.
- Server-sent events: every answer is a plain JSON reply.
- An undo list per connection (the page history already keeps the state before each change).
