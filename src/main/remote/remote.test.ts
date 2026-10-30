import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AI_PRIVATE_MESSAGE } from '../../shared/aiPrivate'
import { DEFAULT_REMOTE_CONFIG, cleanPublicUrl, cleanRemoteConfig, type RemoteConfig } from '../../shared/mcp'
import { TASK_PROPS, TASKS_DATABASE_ID } from '../../shared/tasks'
import { ToolError } from '../ai/tools'
import type { Repository } from '../db/repository'
import { ensureTasksDatabase } from '../db/tasks'
import { openTestRepository } from '../db/testing'
import { AuthStore, allowedRedirect, challengeOf, redirectMatches } from './auth'
import type { Fetch } from './github'
import type { RemoteServer } from './server'
import { createRemoteServer, toolsFor } from './service'
import { callTaskTool } from './tasks'

// A Thursday, 10:00 local time.
const NOW = new Date(2026, 9, 29, 10, 0)
const VERIFIER = 'v'.repeat(20) + 'erifier-with-enough-length-1234567890'
const LOOPBACK = 'http://127.0.0.1/callback'

describe('redirects', () => {
  it('lets in Claude and loopback addresses only', () => {
    expect(allowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(allowedRedirect('http://localhost:33418/callback')).toBe(true)
    expect(allowedRedirect('https://evil.example/cb')).toBe(false)
    expect(allowedRedirect('http://192.168.0.2/cb')).toBe(false)
  })

  it('matches a loopback redirect on any port, and anything else exactly', () => {
    expect(redirectMatches([LOOPBACK], 'http://127.0.0.1:5555/callback')).toBe(true)
    expect(redirectMatches([LOOPBACK], 'http://127.0.0.1:5555/other')).toBe(false)
    expect(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.ai/api/mcp/auth_callback/')).toBe(false)
  })
})

describe('settings', () => {
  it('cleans what is stored', () => {
    expect(cleanRemoteConfig(null)).toEqual(DEFAULT_REMOTE_CONFIG)
    expect(cleanRemoteConfig({ enabled: true, publicUrl: 'https://pc.ts.net/', port: 80, githubLogin: 'bad login' })).toEqual({
      ...DEFAULT_REMOTE_CONFIG,
      enabled: true,
      publicUrl: 'https://pc.ts.net'
    })
    expect(cleanPublicUrl('http://pc.ts.net')).toBeNull()
    expect(cleanPublicUrl('https://pc.ts.net?x=1')).toBeNull()
  })
})

describe('the task tools', () => {
  let repo: Repository
  beforeEach(() => {
    repo = openTestRepository()
    ensureTasksDatabase(repo)
  })

  it('adds a task from quick-add words, creating its project and label', () => {
    const text = callTaskTool(repo, 'add_task', { text: 'Pagar aluguel amanhã 9h p1 #Casa @contas' }, NOW)
    expect(text).toMatch(/Pagar aluguel \[.+\] · due 2026-10-30 09:00 · P1 · #Casa · @contas/)
    const rows = repo.children(TASKS_DATABASE_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0].props.values?.[TASK_PROPS.priority]).toBe('tasks.p1')
  })

  it('lists today with overdue, completes and reschedules', () => {
    callTaskTool(repo, 'add_task', { text: 'Old thing' }, NOW)
    const old = repo.children(TASKS_DATABASE_ID)[0].id
    callTaskTool(repo, 'reschedule_task', { id: old, when: '2026-10-27' }, NOW)
    callTaskTool(repo, 'add_task', { text: 'Later next week p2' }, NOW)
    callTaskTool(repo, 'add_task', { text: 'Someday' }, NOW)
    const today = callTaskTool(repo, 'list_tasks', { list: 'today' }, NOW)
    expect(today).toContain('Old thing')
    expect(today).not.toContain('Someday')
    const id = /Old thing \[([^\]]+)\]/u.exec(today)?.[1] as string
    expect(callTaskTool(repo, 'reschedule_task', { id, when: '2026-11-02' }, NOW)).toContain('due 2026-11-02')
    expect(callTaskTool(repo, 'complete_task', { id }, NOW)).toContain('Done')
    expect(callTaskTool(repo, 'list_tasks', { list: 'all' }, NOW)).not.toContain('Old thing')
    expect(callTaskTool(repo, 'list_tasks', { list: 'inbox' }, NOW)).toContain('Someday')
  })

  it('keeps a private Tasks database closed', () => {
    callTaskTool(repo, 'add_task', { text: 'Secret' }, NOW)
    repo.update(TASKS_DATABASE_ID, { props: { aiPrivate: true } })
    expect(() => callTaskTool(repo, 'list_tasks', {}, NOW)).toThrow(new ToolError(AI_PRIVATE_MESSAGE))
    expect(() => callTaskTool(repo, 'add_task', { text: 'More' }, NOW)).toThrow(ToolError)
  })

  it('offers tools by scope', () => {
    const names = (scopes: Parameters<typeof toolsFor>[0]): string[] => toolsFor(scopes).map((tool) => tool.name)
    expect(names(['read'])).toContain('list_tasks')
    expect(names(['read'])).not.toContain('add_task')
    expect(names(['tasks'])).toEqual(['add_task', 'complete_task', 'reschedule_task'])
    expect(names(['read', 'tasks'])).not.toContain('create_page')
    expect(names(['write'])).toContain('create_page')
  })
})

describe('the remote server', () => {
  let repo: Repository
  let server: RemoteServer
  let auth: AuthStore
  let base: string
  let saved: string | null
  let githubUser: string
  let githubId: number
  let clock: number
  const config: RemoteConfig = { ...DEFAULT_REMOTE_CONFIG, enabled: true, githubClientId: 'Iv1.abc', githubLogin: 'erik-sc' }

  const fakeGitHub: Fetch = async (url) => {
    if (url.startsWith('https://github.com/login/oauth/access_token'))
      return { ok: true, status: 200, json: async () => ({ access_token: 'gho_x' }) }
    if (url === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ login: githubUser, id: githubId }) }
    return { ok: false, status: 404, json: async () => ({}) }
  }

  beforeEach(async () => {
    repo = openTestRepository()
    ensureTasksDatabase(repo)
    saved = null
    githubUser = 'Erik-SC'
    githubId = 42
    clock = Date.now()
    const made = await createRemoteServer(repo, {
      config: () => config,
      secret: () => 'secret-123456',
      changed: () => undefined,
      fetch: fakeGitHub,
      now: () => clock,
      load: () => saved,
      save: (text) => {
        saved = text
      }
    })
    server = made.server
    auth = made.auth
    auth.openPairing()
    await server.start(0)
    base = `http://127.0.0.1:${server.port}`
  })

  afterEach(() => server.stop())

  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

  const form = (path: string, fields: Record<string, string | string[]>, headers: Record<string, string> = {}): Promise<Response> => {
    const body = new URLSearchParams()
    for (const [key, value] of Object.entries(fields)) for (const each of [value].flat()) body.append(key, each)
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body,
      redirect: 'manual'
    })
  }

  /** Register, sign in on (fake) GitHub, allow: the code and the client. */
  async function authorize(scopes: string[] = ['read', 'tasks']): Promise<{ code: string; clientId: string; redirect: string }> {
    const registered = (await (await post('/register', { client_name: 'Claude', redirect_uris: [LOOPBACK] })).json()) as {
      client_id: string
    }
    const redirect = 'http://127.0.0.1:5555/callback'
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: redirect,
      code_challenge: challengeOf(VERIFIER),
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: `${base}/mcp`
    })
    const start = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' })
    expect(start.status).toBe(302)
    const github = new URL(start.headers.get('location') as string)
    expect(github.host).toBe('github.com')
    const cookie = (start.headers.get('set-cookie') as string).split(';')[0]
    const callback = await fetch(`${base}/oauth/callback?code=gh&state=${github.searchParams.get('state')}`, { headers: { cookie } })
    expect(callback.status).toBe(200)
    const html = await callback.text()
    expect(html).toContain('Let Claude use sel?')
    const flow = /name="flow" value="([^"]+)"/u.exec(html)?.[1] as string
    const allowed = await form('/oauth/consent', { flow, decision: 'allow', scope: scopes }, { cookie })
    expect(allowed.status).toBe(302)
    const back = new URL(allowed.headers.get('location') as string)
    expect(back.searchParams.get('state')).toBe('xyz')
    return { code: back.searchParams.get('code') as string, clientId: registered.client_id, redirect }
  }

  async function tokens(): Promise<{ access_token: string; refresh_token: string; clientId: string }> {
    const { code, clientId, redirect } = await authorize()
    const reply = await form('/token', {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirect,
      code_verifier: VERIFIER
    })
    expect(reply.status).toBe(200)
    return { ...((await reply.json()) as { access_token: string; refresh_token: string }), clientId }
  }

  const rpc = async (token: string, method: string, params: unknown = {}): Promise<Record<string, unknown>> => {
    const reply = await post('/mcp', { jsonrpc: '2.0', id: 1, method, params }, { Authorization: `Bearer ${token}` })
    return (await reply.json()) as Record<string, unknown>
  }

  it('asks for authorization and says where', async () => {
    const reply = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(reply.status).toBe(401)
    expect(reply.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`)
    const metadata = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as Record<string, unknown>
    expect(metadata['resource']).toBe(`${base}/mcp`)
    expect(metadata['authorization_servers']).toEqual([base])
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>
    expect(as['code_challenge_methods_supported']).toEqual(['S256'])
    expect(as['scopes_supported']).toContain('offline_access')
  })

  it('refuses new apps unless pairing was opened in Settings', async () => {
    auth.closePairing()
    const reply = await post('/register', { client_name: 'Claude', redirect_uris: [LOOPBACK] })
    expect(reply.status).toBe(403)
    expect(((await reply.json()) as { error: string }).error).toBe('access_denied')
    auth.openPairing()
    clock += 11 * 60 * 1000
    expect((await post('/register', { redirect_uris: [LOOPBACK] })).status).toBe(403)
  })

  it('registers a client asking for a secret as a public one', async () => {
    const reply = await post('/register', { redirect_uris: [LOOPBACK], token_endpoint_auth_method: 'client_secret_post' })
    expect(reply.status).toBe(201)
    expect(((await reply.json()) as { token_endpoint_auth_method: string }).token_endpoint_auth_method).toBe('none')
  })

  it('refuses to register a redirect that is not Claude or this computer', async () => {
    const reply = await post('/register', { redirect_uris: ['https://evil.example/cb'] })
    expect(reply.status).toBe(400)
    expect(((await reply.json()) as { error: string }).error).toBe('invalid_redirect_uri')
  })

  it('goes from sign-in to tools, with the scopes allowed', async () => {
    const { access_token } = await tokens()
    const init = (await rpc(access_token, 'initialize', { protocolVersion: '2025-06-18' })) as { result: { serverInfo: { name: string } } }
    expect(init.result.serverInfo.name).toBe('sel')
    const list = (await rpc(access_token, 'tools/list')) as { result: { tools: { name: string }[] } }
    const names = list.result.tools.map((tool) => tool.name)
    expect(names).toContain('add_task')
    expect(names).not.toContain('create_page')
    const added = (await rpc(access_token, 'tools/call', { name: 'add_task', arguments: { text: 'Buy milk' } })) as {
      result: { content: { text: string }[]; isError: boolean }
    }
    expect(added.result.isError).toBe(false)
    expect(added.result.content[0].text).toContain('Buy milk')
    const refused = (await rpc(access_token, 'tools/call', { name: 'create_page', arguments: { title: 'x' } })) as {
      result: { isError: boolean }
    }
    expect(refused.result.isError).toBe(true)
    expect(server.calls.map((call) => call.tool)).toEqual(['create_page', 'add_task'])
    expect(auth.list()).toHaveLength(1)
    expect(saved).not.toContain(access_token)
  })

  it('lets a refresh be retried at once, without ending the grant or cutting calls in flight', async () => {
    const first = await tokens()
    const refresh = (): Promise<Response> =>
      form('/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: first.clientId })
    expect((await refresh()).status).toBe(200)
    // The token from before the refresh still works until it expires.
    const ping = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${first.access_token}` })
    expect(ping.status).toBe(200)
    const retried = (await (await refresh()).json()) as { access_token: string }
    expect(retried.access_token).toMatch(/^sel_at_/u)
    expect(auth.list()).toHaveLength(1)
  })

  it('rotates refresh tokens and ends the grant when a spent one comes back', async () => {
    const first = await tokens()
    const second = (await (
      await form('/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: first.clientId })
    ).json()) as {
      access_token: string
      refresh_token: string
    }
    expect(second.refresh_token).not.toBe(first.refresh_token)
    clock += 2 * 60 * 1000
    const replay = await form('/token', { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: first.clientId })
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant')
    const after = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${second.access_token}` })
    expect(after.status).toBe(401)
  })

  it('refuses a wrong PKCE verifier and a used code', async () => {
    const { code, clientId, redirect } = await authorize()
    const wrong = await form('/token', {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirect,
      code_verifier: `x${VERIFIER}`
    })
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_grant')
    const again = await form('/token', {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirect,
      code_verifier: VERIFIER
    })
    expect(((await again.json()) as { error: string }).error).toBe('invalid_grant')
  })

  it('lets in only the GitHub account named in settings', async () => {
    githubUser = 'someone-else'
    const registered = (await (await post('/register', { redirect_uris: [LOOPBACK] })).json()) as { client_id: string }
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: registered.client_id,
      redirect_uri: LOOPBACK,
      code_challenge: challengeOf(VERIFIER),
      code_challenge_method: 'S256'
    })
    const start = await fetch(`${base}/authorize?${query}`, { redirect: 'manual' })
    const state = new URL(start.headers.get('location') as string).searchParams.get('state')
    const cookie = (start.headers.get('set-cookie') as string).split(';')[0]
    const callback = await fetch(`${base}/oauth/callback?code=gh&state=${state}`, { headers: { cookie } })
    expect(callback.status).toBe(403)
    // Without the browser's cookie, the sign-in is not this one.
    const stolen = await fetch(`${base}/oauth/callback?code=gh&state=${state}`)
    expect(stolen.status).toBe(400)
  })

  it('pins the GitHub account by id: the same login with another id is refused', async () => {
    await tokens()
    githubId = 7
    await expect(authorize()).rejects.toThrow()
  })

  it('keeps grants across restarts, and revoking ends them', async () => {
    const { access_token } = await tokens()
    const again = new AuthStore({ load: () => saved, save: () => undefined })
    expect(again.authenticate(access_token)?.login).toBe('Erik-SC')
    auth.revoke()
    const after = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${access_token}` })
    expect(after.status).toBe(401)
  })
})

describe('private projects', () => {
  it('cannot take rows through the database tools either', async () => {
    const repo = openTestRepository()
    ensureTasksDatabase(repo)
    callTaskTool(repo, 'add_task', { text: 'Visible #Work' }, NOW)
    const database = repo.get(TASKS_DATABASE_ID)
    const work = database?.props.schema?.[TASK_PROPS.project]?.options?.[0]?.id as string
    repo.update(TASKS_DATABASE_ID, { props: { aiPrivateProjects: [work] } })
    const { callWriteTool } = await import('../ai/writes')
    const markdown = await import('../markdown')
    expect(() =>
      callWriteTool({ repo, markdown }, 'add_database_row', { database: TASKS_DATABASE_ID, values: { Task: 'x', Project: 'Work' } })
    ).toThrow(AI_PRIVATE_MESSAGE)
    expect(() => callTaskTool(repo, 'add_task', { text: 'Another #Work' }, NOW)).toThrow(AI_PRIVATE_MESSAGE)
  })

  it('refuses a public address with a path', () => {
    expect(cleanPublicUrl('https://host.example/sel')).toBeNull()
    expect(cleanPublicUrl('https://host.example/')).toBe('https://host.example')
  })
})
