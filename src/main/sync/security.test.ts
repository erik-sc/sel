/**
 * What must hold for sync whatever a person types, a repository contains or git prints:
 * the address of a remote, how git is started, what reaches the renderer, the encryption,
 * and the files read back from a repository.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { checkRemoteUrl, cleanBranch, cleanDeviceName, isPassphrase, SYNC_MESSAGES } from '../../shared/sync'
import { openTestRepository } from '../db/testing'
import * as arg from '../validate'
import { createEncryption, exportKeys, hiddenName, importKeys, keysMatch, open, seal, unlockEncryption, WrongKeyError } from './crypto'
import { SyncEngine } from './engine'
import {
  calendarKey,
  FormatError,
  mergeAppearance,
  mergeCalendars,
  mergeHome,
  parseAppearance,
  parseCalendars,
  parseHome,
  parseMeta,
  parsePage,
  parseRoot,
  serializeCalendars,
  serializeHome,
  serializeMeta,
  serializePage,
  type CalendarsFile,
  type SyncedCalendar
} from './format'
import { classifyGitFailure, configArgs, Git, GIT_FIXED_ENV, gitCandidates, gitEnv, inspectGit, isNonFastForward, locateGit, parseGitVersion, pinnedRepository } from './git'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-sync-sec-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
vi.setConfig({ testTimeout: 120_000 })

describe('remote address', () => {
  it('accepts https and ssh addresses of a repository', () => {
    for (const url of [
      'https://github.com/owner/notes.git',
      'https://github.com/owner/notes',
      'https://git.example.org:8443/team/sub/notes.git',
      'ssh://git@github.com/owner/notes.git',
      'ssh://git@git.example.org:2222/owner/notes.git',
      'ssh://github.com/owner/notes.git',
      'git@github.com:owner/notes.git',
      'git@gitlab.com:group/sub-group/notes.git',
      'user_1@host.example.com:/srv/git/notes.git'
    ]) {
      expect(checkRemoteUrl(url), url).toMatchObject({ ok: true })
    }
    expect(checkRemoteUrl('git@github.com:owner/notes.git')).toEqual({ ok: true, url: 'git@github.com:owner/notes.git', kind: 'ssh' })
    expect(checkRemoteUrl('https://github.com/owner/notes.git')).toEqual({ ok: true, url: 'https://github.com/owner/notes.git', kind: 'https' })
  })

  it('refuses credentials inside the address', () => {
    for (const url of [
      'https://user:token@github.com/owner/notes.git',
      'https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/owner/notes.git',
      'https://user@github.com/owner/notes.git',
      'https://:secret@github.com/owner/notes.git',
      'https://a@b@github.com/owner/notes.git',
      'ssh://git:password@github.com/owner/notes.git',
      'ssh://a@b@github.com/owner/notes.git'
    ]) {
      expect(checkRemoteUrl(url), url).toEqual({ ok: false, problem: 'credentials' })
    }
  })

  it('refuses every transport but https and ssh', () => {
    for (const url of [
      'http://github.com/owner/notes.git',
      'git://github.com/owner/notes.git',
      'ftp://example.com/notes.git',
      'ftps://example.com/notes.git',
      'file:///C:/Users/me/notes.git',
      'file://server/share/notes.git',
      'ext::sh -c "touch /tmp/pwned"',
      'ext::ssh%20-oProxyCommand=calc%20x',
      'fd::17/foo',
      'persistent-https://github.com/owner/notes.git',
      'https::https://github.com/owner/notes.git',
      'foo::https://github.com/owner/notes.git',
      'javascript:alert(1)',
      'data:text/plain,x',
      'C:\\Users\\me\\notes.git',
      'C:/Users/me/notes.git',
      '/srv/git/notes.git',
      '../notes.git',
      './notes.git',
      '\\\\server\\share\\notes.git',
      '//server/share/notes.git',
      'notes.git',
      'github.com/owner/notes.git',
      'github.com:owner/notes.git'
    ]) {
      expect(checkRemoteUrl(url).ok, url).toBe(false)
    }
  })

  it('refuses anything git or ssh could read as an option', () => {
    for (const url of [
      '-oProxyCommand=calc',
      '--upload-pack=touch /tmp/pwned',
      '--config=core.sshCommand=calc',
      'ssh://-oProxyCommand=calc/x',
      'ssh://git@-oProxyCommand=calc/x',
      'ssh://-oProxyCommand=calc@github.com/x',
      'git@-oProxyCommand=calc:owner/notes.git',
      '-oProxyCommand=calc@github.com:owner/notes.git',
      'git@github.com:-oProxyCommand=calc',
      'git@github.com:owner/-x.git',
      'https://-oProxyCommand=calc/owner/notes.git',
      'https://github.com/-oProxyCommand',
      'https://github.com/owner/../../etc/passwd',
      'git@github.com:../../etc/passwd'
    ]) {
      expect(checkRemoteUrl(url).ok, url).toBe(false)
    }
  })

  it('refuses whitespace, control characters, queries, fragments and oversized input', () => {
    for (const url of [
      '',
      ' https://github.com/owner/notes.git',
      'https://github.com/owner/notes.git ',
      'https://github.com/owner/notes.git\n--upload-pack=x',
      'https://github.com/owner/notes.git\r\n',
      'https://github.com/owner/no tes.git',
      'https://github.com/owner/notes.git\u0000',
      'https://github.com/owner/notes.git\t-x',
      'git@github.com:owner/notes.git\n-oProxyCommand=x',
      'https://github.com/owner/notes.git?token=abc',
      'https://github.com/owner/notes.git#frag',
      'https://github.com/',
      'https://github.com',
      'https:///owner/notes.git',
      'https://exa$mple.com/owner/notes.git',
      'https://github.com/owner/notes.git;rm -rf',
      'https://github.com/owner/`id`.git',
      'https://github.com/owner/$(id).git',
      'https://github.com/owner/notes.git&calc',
      'https://github.com/owner/notes.git|calc',
      `https://github.com/${'a'.repeat(600)}`,
      null,
      undefined,
      42,
      {},
      ['https://github.com/owner/notes.git']
    ]) {
      expect(checkRemoteUrl(url).ok, String(url)).toBe(false)
    }
  })

  it('accepts a folder only where tests ask for it, and still never an option or a helper', () => {
    expect(checkRemoteUrl('C:\\Temp\\remote.git').ok).toBe(false)
    expect(checkRemoteUrl('C:\\Temp\\remote.git', true)).toEqual({ ok: true, url: 'C:\\Temp\\remote.git', kind: 'local' })
    expect(checkRemoteUrl('/tmp/remote dir/x.git', true)).toMatchObject({ ok: true, kind: 'local' })
    for (const url of ['-C:\\x', '--upload-pack=x', 'ext::sh -c x', 'C:\\x::y', 'relative/path', '\\\\server\\share', '//server/share', 'C:\\x\ny', 'file:///C:/x']) {
      expect(checkRemoteUrl(url, true).ok, url).toBe(false)
    }
  })

  it('cleans branch names, device names and passphrases', () => {
    for (const ok of ['main', 'master', 'device/laptop', 'v1.2', 'a_b-c']) expect(cleanBranch(ok)).toBe(ok)
    for (const bad of ['', '-main', '--force', 'a..b', 'a b', 'main\n', 'a//b', 'a/.b', 'a/', 'a.', 'x.lock', 'a~1', 'a^', 'a:b', 'a?b', 'a*', 'a[b', 'a\\b', '@{-1}', 'HEAD^{commit}', 'a'.repeat(101), 5, null]) {
      expect(cleanBranch(bad), String(bad)).toBeNull()
    }
    expect(cleanDeviceName('Erik\u2019s  MacBook Pro (work)')).toBe('Eriks MacBook Pro (work)')
    expect(cleanDeviceName('--upload-pack=evil; rm -rf ~')).toBe('upload-packevil rm -rf')
    expect(cleanDeviceName('a\nb\r\n"c" <d@e.f>')).toBe('a b c de.f')
    expect(cleanDeviceName('   ')).toBe('This device')
    expect(cleanDeviceName(null, 'Fallback')).toBe('Fallback')
    expect(cleanDeviceName('x'.repeat(200))).toHaveLength(48)
    expect(isPassphrase('1234567')).toBe(false)
    expect(isPassphrase('12345678')).toBe(true)
    expect(isPassphrase('x'.repeat(257))).toBe(false)
    expect(isPassphrase(12345678)).toBe(false)
  })
})

describe('how git is started', () => {
  it('passes only an allow-listed environment plus the no-prompt variables', () => {
    const env = gitEnv({
      PATH: '/usr/bin',
      HOME: '/home/me',
      SSH_AUTH_SOCK: '/tmp/agent',
      HTTPS_PROXY: 'http://proxy:3128',
      GITHUB_TOKEN: 'ghp_secret',
      GH_TOKEN: 'secret',
      ANTHROPIC_API_KEY: 'sk-secret',
      AWS_SECRET_ACCESS_KEY: 'secret',
      NPM_TOKEN: 'secret',
      GIT_DIR: '/somewhere/else',
      GIT_WORK_TREE: '/somewhere/else',
      GIT_CONFIG_GLOBAL: '/tmp/evil-config',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.sshCommand',
      GIT_CONFIG_VALUE_0: 'calc',
      GIT_ASKPASS: '/tmp/evil-askpass',
      SSH_ASKPASS: '/tmp/evil-askpass',
      GIT_SSH_COMMAND: 'calc',
      GIT_EXEC_PATH: '/tmp/evil',
      GIT_TERMINAL_PROMPT: '1',
      GCM_INTERACTIVE: 'always',
      LD_PRELOAD: '/tmp/evil.so',
      NODE_OPTIONS: '--require /tmp/evil.js',
      ELECTRON_RUN_AS_NODE: '1'
    })
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/me', SSH_AUTH_SOCK: '/tmp/agent', HTTPS_PROXY: 'http://proxy:3128' })
    expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', SSH_ASKPASS_REQUIRE: 'never', LC_ALL: 'C' })
    for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'NPM_TOKEN', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_SSH_COMMAND', 'GIT_EXEC_PATH', 'LD_PRELOAD', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']) {
      expect(env[name], name).toBeUndefined()
    }
    expect(Object.values(env).join('\n')).not.toContain('secret')
    expect(GIT_FIXED_ENV['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(pinnedRepository(join(ROOT, 'x', 'repo'))).toEqual({ GIT_DIR: join(ROOT, 'x', 'repo', '.git'), GIT_WORK_TREE: join(ROOT, 'x', 'repo'), GIT_CEILING_DIRECTORIES: join(ROOT, 'x') })
  })

  it('sets identity and behaviour per command, with helper transports off', () => {
    const args = configArgs({ deviceName: 'Laptop', hooksDir: '/tmp/no-hooks', allowLocal: false })
    const settings = args.filter((_, index) => index % 2 === 1)
    expect(args.filter((_, index) => index % 2 === 0).every((flag) => flag === '-c')).toBe(true)
    for (const expected of [
      'core.autocrlf=false',
      'core.longpaths=true',
      'gc.auto=0',
      'user.name=Laptop',
      'user.email=sel@localhost',
      'protocol.ext.allow=never',
      'protocol.file.allow=never',
      'commit.gpgsign=false',
      'core.askPass=',
      'credential.interactive=false',
      'core.hooksPath=/tmp/no-hooks'
    ]) {
      expect(settings, expected).toContain(expected)
    }
    expect(configArgs({ deviceName: 'Laptop', hooksDir: '/x', allowLocal: true })).toContain('protocol.file.allow=user')
    expect(() => configArgs({ deviceName: 'a\nb', hooksDir: '/x', allowLocal: false })).toThrow()
    expect(() => configArgs({ deviceName: '-x', hooksDir: '/x', allowLocal: false })).toThrow()
    expect(() => configArgs({ deviceName: 'ok', hooksDir: '/x\n-c core.sshCommand=calc', allowLocal: false })).toThrow()
  })

  it('only ever runs a real git executable found by absolute path', () => {
    const dir = join(ROOT, 'bin')
    mkdirSync(dir, { recursive: true })
    const windows = process.platform === 'win32'
    const real = join(dir, windows ? 'git.exe' : 'git')
    writeFileSync(real, '')
    writeFileSync(join(dir, 'git.cmd'), '')
    writeFileSync(join(dir, 'notgit.exe'), '')
    expect(inspectGit(real)).toBe(real)
    expect(inspectGit(join(dir, 'git.cmd'))).toBeNull()
    expect(inspectGit(join(dir, 'notgit.exe'))).toBeNull()
    expect(inspectGit(dir)).toBeNull()
    expect(inspectGit(windows ? 'git.exe' : 'git')).toBeNull()
    expect(inspectGit(`${real}\0x`)).toBeNull()
    expect(inspectGit(join(dir, 'missing', windows ? 'git.exe' : 'git'))).toBeNull()
    expect(inspectGit(42)).toBeNull()
    // PATH is searched, relative entries are not, and a chosen file is used alone.
    const sep = windows ? ';' : ':'
    expect(locateGit({ env: { PATH: `.${sep}relative${sep}${dir}` }, platform: process.platform })).toBe(real)
    expect(gitCandidates({ env: { PATH: `.${sep}relative` }, platform: process.platform }).some((path) => path.includes('relative'))).toBe(false)
    expect(locateGit({ explicit: join(dir, 'git.cmd'), env: { PATH: dir } })).toBeNull()
    expect(gitCandidates({ env: { PATH: '', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, platform: 'win32' })).toEqual(
      expect.arrayContaining([join('C:\\Program Files', 'Git', 'cmd', 'git.exe'), join('C:\\Users\\me\\AppData\\Local', 'Programs', 'Git', 'cmd', 'git.exe')])
    )
  })

  it('reads the version and recognises a push that only needs a retry', () => {
    expect(parseGitVersion('git version 2.47.1.windows.1\n')).toBe('2.47.1')
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5')
    expect(parseGitVersion('something else')).toBeNull()
    expect(isNonFastForward('!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)')).toBe(true)
    expect(isNonFastForward(' ! [rejected]        main -> main (non-fast-forward)')).toBe(true)
    expect(isNonFastForward('!\trefs/heads/main:refs/heads/main\t[remote rejected] (protected branch hook declined)')).toBe(false)
    expect(isNonFastForward('fatal: unable to access')).toBe(false)
  })
})

describe('what a failure says', () => {
  const cases: [string, string][] = [
    ["fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com", 'offline'],
    ["fatal: unable to access 'https://github.com/o/r.git/': Failed to connect to github.com port 443 after 21050 ms: Timed out", 'offline'],
    ['ssh: connect to host github.com port 22: Connection timed out\nfatal: Could not read from remote repository.', 'offline'],
    ["remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found", 'repo-not-found'],
    ["fatal: '/tmp/x.git' does not appear to be a git repository\nfatal: Could not read from remote repository.", 'repo-not-found'],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'auth-failed'],
    ["remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/o/r.git/'", 'auth-failed'],
    ['fatal: Cannot prompt because user interactivity has been disabled.', 'auth-failed'],
    ['git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', 'auth-failed'],
    ["fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403", 'auth-failed'],
    ['remote: error: GH006: Protected branch update failed for refs/heads/main.\n ! [remote rejected] main -> main (protected branch hook declined)', 'rejected'],
    ["remote: Permission to o/r.git denied to someone.\nfatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403", 'rejected'],
    [' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs', 'rejected'],
    ['error: unable to write file pages/x.json: No space left on device\nfatal: unable to checkout working tree', 'disk-full'],
    ['fatal: something nobody has seen before in C:\\Users\\erik\\secret-project with token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'failed']
  ]

  it('maps what git prints to a cause, and never repeats git', () => {
    for (const [stderr, code] of cases) {
      const failure = classifyGitFailure(stderr, 128)
      expect(failure.code, stderr).toBe(code)
      // The message is one of ours: no address, no path, no token, nothing a server sent.
      const said = JSON.stringify(failure.toError())
      for (const leak of ['github.com', 'https://', 'ghp_', 'C:\\\\Users', '/tmp/', 'o/r.git', 'GH006', 'someone']) expect(said, `${stderr} leaks ${leak}`).not.toContain(leak)
      expect([...Object.values(SYNC_MESSAGES), 'Another device uploaded first.']).toContain(failure.message)
    }
    expect(classifyGitFailure('fatal: not a git repository: C:/x/.git', 128).corrupt).toBe(true)
    expect(classifyGitFailure('error: object file .git/objects/ab/cd is empty', 128).corrupt).toBe(true)
    expect(classifyGitFailure('', 9009).code).toBe('git-not-found')
  })

  it('explains what to do about a sign-in problem without storing anything', () => {
    expect(SYNC_MESSAGES['auth-failed']).toContain('Git Credential Manager')
    expect(SYNC_MESSAGES['auth-failed']).toContain('gh auth login')
    expect(SYNC_MESSAGES['auth-failed']).toContain('sel stores no token')
  })

  it('keeps every sync setting out of the renderer\'s reach for writing', () => {
    for (const key of ['sync.remoteUrl', 'sync.branch', 'sync.gitPath', 'sync.encrypted', 'sync.firstMode', 'sync.anything', 'rootOrderAt']) {
      expect(() => arg.writableSettingKey(key), key).toThrow('read-only')
    }
  })
})

const GIT = locateGit()
const withGit = GIT ? describe : describe.skip

withGit('every git command that is actually run', () => {
  it('has no user text in option position, a pinned repository and no way to prompt', async () => {
    const remote = join(ROOT, 'remote with spaces & (odd) chars.git')
    mkdirSync(remote)
    execFileSync(GIT as string, ['init', '--bare', '-q', '-b', 'main'], { cwd: remote })
    const spawns: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = []
    const make = (name: string, hostName: string): { repo: ReturnType<typeof openTestRepository>; engine: SyncEngine } => {
      const repo = openTestRepository()
      const engine = new SyncEngine({
        repo,
        dir: join(ROOT, name, 'sync'),
        filesDir: join(ROOT, name, 'files'),
        hostName,
        allowLocal: true,
        secrets: { load: () => null, save: () => undefined },
        acceptImage: () => true,
        onSpawn: (args, env) => spawns.push({ args, env })
      })
      return { repo, engine }
    }
    const hostile = '--upload-pack=touch pwned; $(calc) `id` "x" \n -c core.sshCommand=calc'
    const a = make('a', 'fallback')
    const page = a.repo.create({ type: 'page', parentId: null, props: { title: [['--force; $(rm -rf ~) `id` "quoted" \n second line']] } })
    a.repo.create({ type: 'text', parentId: page.id, props: { title: [['-oProxyCommand=calc']] } })
    expect((await a.engine.setup({ remoteUrl: remote, deviceName: hostile, branch: 'main' })).lastError).toBeUndefined()
    const b = make('b', hostile)
    expect((await b.engine.setup({ remoteUrl: remote })).lastError).toBeUndefined()
    b.repo.create({ type: 'page', parentId: null, props: { title: [['from b']] } })
    expect((await b.engine.now()).lastError).toBeUndefined()
    expect((await a.engine.now()).lastError).toBeUndefined()
    await a.engine.setEncryption('a passphrase for the test')
    expect(spawns.length).toBeGreaterThan(20)

    const device = cleanDeviceName(hostile)
    expect(device).not.toMatch(/^-|[;$`"\n=]/)
    const OPTIONS = new Set(['-c', '-q', '-r', '-z', '-f', '-d', '-x', '-B', '-A', '-F', '-', '--', '--version', '--quiet', '--no-tags', '--full-tree', '--name-only', '--batch', '--no-verify', '--allow-empty', '--porcelain', '--symref', '--verify', '--get', '--git-dir'])
    const COMMANDS = new Set(['init', 'remote', 'fetch', 'ls-tree', 'cat-file', 'checkout', 'clean', 'add', 'commit', 'push', 'update-ref', 'symbolic-ref', 'rev-parse', 'ls-remote', 'config'])
    for (const { args, env } of spawns) {
      const line = args.join(' ')
      // The leading settings: `-c key=value` pairs, the only place the device name appears.
      let at = 0
      while (args[at] === '-c') {
        const setting = args[at + 1]
        expect(setting, line).toMatch(/^[a-z]+\.[A-Za-z.]+=/)
        if (!setting.startsWith('user.name=') && !setting.startsWith('core.hooksPath=')) expect(setting, line).toMatch(/^[a-zA-Z.]+=[a-z0-9@.]*$/)
        at += 2
      }
      expect(at).toBeGreaterThan(20)
      const rest = args.slice(at)
      expect(COMMANDS.has(rest[0]) || rest[0] === '--version', line).toBe(true)
      const dashes = rest.indexOf('--')
      rest.forEach((value, index) => {
        if (index === 0) return
        // Whatever starts with a dash is one of the fixed options, never something that was typed.
        if (value.startsWith('-') && (dashes < 0 || index <= dashes)) expect(OPTIONS.has(value), `${value} in: ${line}`).toBe(true)
        if (value === remote) expect(dashes >= 0 && index > dashes, `the address is not after "--": ${line}`).toBe(true)
        expect(value.includes(device) || value.includes('upload-pack') || value.includes('core.sshCommand'), `device name outside user.name: ${line}`).toBe(false)
        // Page titles and block text never reach a command line.
        expect(value.includes('rm -rf') || value.includes('ProxyCommand') || value.includes('quoted'), line).toBe(false)
        expect(value.includes('passphrase'), line).toBe(false)
      })
      expect(args.filter((value) => value === `user.name=${device}`), line).toHaveLength(1)
      expect(args.some((value) => value.includes('\n') || value.includes('\0')), line).toBe(false)
      expect(env['GIT_TERMINAL_PROMPT'], line).toBe('0')
      expect(env['GCM_INTERACTIVE'], line).toBe('never')
      expect(env['GIT_DIR'], line).toMatch(/[\\/]sync[\\/]repo[\\/]\.git$/)
      expect(env['GIT_ASKPASS'], line).toBeUndefined()
      // Nothing is forced, and the user's own configuration is never written.
      if (rest[0] === 'push') expect(rest.some((value) => value.startsWith('+') || value.includes('force') || value === '-f'), line).toBe(false)
      expect(rest.includes('--global') || rest.includes('--system'), line).toBe(false)
    }
    // The commit carries the cleaned name, and the hostile text made nothing happen.
    const author = execFileSync(GIT as string, ['log', '--format=%an', 'main'], { cwd: remote, encoding: 'utf8' })
    expect(author.split('\n').filter(Boolean).every((name) => name === device)).toBe(true)
  })

  it('stops a git that hangs, and reports a cancelled run as cancelled', async () => {
    const cwd = join(ROOT, 'hang')
    mkdirSync(cwd, { recursive: true })
    const git = new Git({ gitPath: GIT as string, cwd, deviceName: 'x', hooksDir: join(ROOT, 'no-hooks'), allowLocal: true })
    await git.run(['init', '-q'])
    // `cat-file --batch` waits on stdin for ever when nothing closes it: the timeout ends it.
    const started = Date.now()
    await expect(git.run(['cat-file', '--batch-check', '--buffer'], { input: Buffer.alloc(0), timeoutMs: 30_000 })).resolves.toMatchObject({ code: 0 })
    const slow = git.run(['fetch', 'https://192.0.2.1/x.git'], { timeoutMs: 600, network: true })
    await expect(slow).rejects.toMatchObject({ code: 'offline' })
    expect(Date.now() - started).toBeLessThan(20_000)
    git.cancel()
    await expect(git.run(['status'])).rejects.toMatchObject({ code: 'cancelled' })
    git.resume()
    await expect(git.run(['status', '--porcelain'])).resolves.toMatchObject({ code: 0 })
    await expect(git.run(['status', '\0bad'])).rejects.toMatchObject({ code: 'failed' })
  })
})

describe('encryption', () => {
  const COST = { N: 1 << 14, r: 8, p: 1 }

  it('seals and opens files, and notices a wrong key or a changed bit', async () => {
    const { params, keys } = await createEncryption('correct horse', COST)
    expect(params).toMatchObject({ v: 1, kdf: 'scrypt', N: COST.N, r: 8, p: 1 })
    expect(Buffer.from(params.salt, 'base64')).toHaveLength(16)
    expect(keysMatch(keys, params)).toBe(true)
    const text = Buffer.from('{"title":"A secret page"}'.repeat(50))
    const sealedFile = seal(keys, 'pages/abc.json', text, true)
    expect(sealedFile.includes('secret')).toBe(false)
    expect(sealedFile.includes('abc')).toBe(false)
    expect(sealedFile.length).toBeLessThan(text.length)
    expect(open(keys, sealedFile)).toEqual({ name: 'pages/abc.json', bytes: text })
    // The same content never gives the same bytes twice.
    expect(seal(keys, 'pages/abc.json', text, true).equals(sealedFile)).toBe(false)

    const other = await createEncryption('correct horse', COST)
    expect(other.params.salt).not.toBe(params.salt)
    expect(() => open(other.keys, sealedFile)).toThrow(WrongKeyError)
    expect(keysMatch(other.keys, params)).toBe(false)
    for (const at of [0, 5, 20, sealedFile.length - 1]) {
      const tampered = Buffer.from(sealedFile)
      tampered[at] ^= 1
      expect(() => open(keys, tampered), `byte ${at}`).toThrow(WrongKeyError)
    }
    expect(() => open(keys, sealedFile.subarray(0, 10))).toThrow(WrongKeyError)
    expect(() => open(keys, Buffer.from('{"format":1}'))).toThrow(WrongKeyError)
  })

  it('derives the same key from the same passphrase and tells a wrong one apart', async () => {
    const { params, keys } = await createEncryption('pässphrase with ünicode', COST)
    const again = await unlockEncryption('pässphrase with ünicode', params)
    expect(again?.enc.equals(keys.enc)).toBe(true)
    // The decomposed spelling of the same characters is the same passphrase.
    expect((await unlockEncryption('pässphrase with ünicode'.normalize('NFD'), params))?.enc.equals(keys.enc)).toBe(true)
    expect(await unlockEncryption('passphrase with unicode', params)).toBeNull()
    expect(await unlockEncryption('', params)).toBeNull()
    expect(hiddenName(keys, 'pages/abc.json')).toMatch(/^[0-9a-f]{40}$/)
    expect(hiddenName(keys, 'pages/abc.json')).toBe(hiddenName(keys, 'pages/abc.json'))
    expect(hiddenName(keys, 'pages/abd.json')).not.toBe(hiddenName(keys, 'pages/abc.json'))
    expect(importKeys(exportKeys(keys))?.name.equals(keys.name)).toBe(true)
    expect(importKeys({ enc: 'AAAA', name: 'AAAA' })).toBeNull()
    expect(importKeys(null)).toBeNull()
  })
})

describe('files read from a repository', () => {
  const block = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id, type: 'text', parentId: 'p', content: [], props: {}, createdAt: 1, updatedAt: 2, trashedAt: null, ...extra })
  const page = (blocks: unknown[], head: Record<string, unknown> = {}): string => JSON.stringify({ format: 1, page: 'p', blocks, ...head })
  const root = block('p', { type: 'page', parentId: null })

  it('round-trips a page file, including the order of a schema', () => {
    const schema = { zeta: { id: 'zeta', name: 'Z', type: 'text' }, title: { id: 'title', name: 'Name', type: 'title' }, alpha: { id: 'alpha', name: 'A', type: 'number' } }
    const text = serializePage('db', [
      { id: 'db', type: 'database', parentId: null, content: ['r2', 'r1'], props: { schema, views: [] }, createdAt: 5, updatedAt: 6, trashedAt: null },
      { id: 'a', type: 'text', parentId: 'db', content: [], props: { title: [['x', [['b']]]] }, createdAt: 1, updatedAt: 2, trashedAt: null }
    ])
    expect(text.endsWith(']}\n')).toBe(true)
    expect(text.split('\n')).toHaveLength(5)
    const parsed = parsePage(text)
    expect(parsed.pageId).toBe('db')
    expect(parsed.blocks.map((b) => b.id)).toEqual(['a', 'db'])
    expect(Object.keys(parsed.blocks[1].props['schema'] as object)).toEqual(['zeta', 'title', 'alpha'])
    expect(parsed.blocks[1].content).toEqual(['r2', 'r1'])
    expect(serializePage('db', parsed.blocks)).toBe(text)
  })

  it('refuses what is not a page file', () => {
    const bad: string[] = [
      '',
      'not json',
      '[]',
      'null',
      JSON.stringify({ format: 1, page: 'p' }),
      JSON.stringify({ format: 1, page: '../x', blocks: [root] }),
      JSON.stringify({ format: 1, page: 'q', blocks: [root] }),
      page([root, block('../../etc')]),
      page([root, block('a b')]),
      page([root, block('a'), block('a')]),
      page([root, block('a', { parentId: 'not an id!' })]),
      page([root, block('a', { props: [] })]),
      page([root, block('a', { props: 'x' })]),
      page([root, 'x']),
      page([root, null])
    ]
    for (const text of bad) expect(() => parsePage(text), text.slice(0, 60)).toThrow(FormatError)
    // A newer writer is reported as such, not as damage.
    for (const text of [page([root], { format: 2 }), page([root, block('a', { type: 'hologram' })])]) {
      let caught: unknown
      try {
        parsePage(text)
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(FormatError)
      expect((caught as FormatError).newer).toBe(true)
    }
  })

  it('cleans what it accepts: no prototype keys, no foreign ids in lists, sane timestamps', () => {
    const text = `{"format":1,"page":"p","blocks":[${JSON.stringify(root)},{"id":"a","type":"text","parentId":"p","content":["ok","../x",5,"ok"],"props":{"__proto__":{"polluted":true},"constructor":1,"title":[["t"]],"schema":{"__proto__":{"x":1}}},"createdAt":-5,"updatedAt":"soon","trashedAt":7}]}`
    const parsed = parsePage(text)
    const a = parsed.blocks.find((b) => b.id === 'a')!
    expect(a.content).toEqual(['ok'])
    expect(Object.keys(a.props).sort()).toEqual(['schema', 'title'])
    expect(Object.keys(a.props['schema'] as object)).toEqual([])
    expect(a.createdAt).toBe(0)
    expect(a.updatedAt).toBe(0)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(parseRoot('{"format":1,"root":["a","../b","a",7],"rootAt":3}')).toEqual({ root: ['a'], rootAt: 3 })
    expect(() => parseRoot('{"format":3,"root":[]}')).toThrow(FormatError)
    expect(parseAppearance('{"format":1,"updatedAt":5,"value":[1,2]}')).toEqual({ updatedAt: 5, value: null })
  })

  it('checks the meta file and bounds the key derivation it may ask for', () => {
    const ok = { v: 1, kdf: 'scrypt', N: 32768, r: 8, p: 1, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', check: 'AAAA' }
    expect(parseMeta(serializeMeta({ app: 'sel', format: 1, workspaceId: 'w1', createdBy: 'Laptop' }))).toEqual({ app: 'sel', format: 1, workspaceId: 'w1', createdBy: 'Laptop' })
    // An encrypted repository says nothing else in the clear.
    expect(JSON.parse(serializeMeta({ app: 'sel', format: 1, workspaceId: 'w1', createdBy: 'Laptop', encryption: ok as never }))).toEqual({ app: 'sel', format: 1, encryption: ok })
    for (const meta of [
      'x',
      '{}',
      '{"app":"other","format":1}',
      '{"app":"sel","format":0}',
      JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, N: 2 ** 30 } }),
      JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, N: 30000 } }),
      JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, r: 1000 } }),
      JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, N: 2 ** 20, r: 16 } }),
      JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, p: 0 } }),
      JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, salt: '../../x' } }),
      JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, check: 5 } })
    ]) {
      expect(() => parseMeta(meta), meta.slice(0, 80)).toThrow(FormatError)
    }
    for (const newer of ['{"app":"sel","format":9}', JSON.stringify({ app: 'sel', format: 1, encryption: { ...ok, kdf: 'argon2id' } })]) {
      expect(() => parseMeta(newer)).toThrow(expect.objectContaining({ newer: true }))
    }
  })

  it('merges appearance settings three ways', () => {
    const file = (updatedAt: number, value: unknown): { updatedAt: number; value: unknown } => ({ updatedAt, value })
    const base = file(1, { light: { a: '1', b: '2' }, dark: {}, shared: {}, customCss: '' })
    const local = file(5, { light: { a: 'L', b: '2' }, dark: {}, shared: {}, customCss: 'local' })
    const remote = file(9, { light: { a: 'R', b: '2', c: '3' }, dark: { d: '4' }, shared: {}, customCss: '' })
    expect(mergeAppearance(base, local, null)).toBe(local)
    expect(mergeAppearance(base, local, base)).toBe(local)
    expect(mergeAppearance(base, base, remote)).toBe(remote)
    expect(mergeAppearance(base, local, remote)).toEqual(file(9, { light: { a: 'R', b: '2', c: '3' }, dark: { d: '4' }, shared: {}, customCss: 'local' }))
    expect(mergeAppearance(base, { ...local, updatedAt: 10 }, remote).value).toMatchObject({ light: { a: 'L', c: '3' } })
    expect(mergeAppearance(null, file(1, null), remote)).toBe(remote)
  })

  it('reads the home file as a page id, one of the screens or nothing', () => {
    const page = { kind: 'page', id: 'p1' } as const
    expect(parseHome(serializeHome({ updatedAt: 7, value: page }))).toEqual({ updatedAt: 7, value: page })
    // Cleared: still a file, so that the other devices clear theirs.
    expect(JSON.parse(serializeHome({ updatedAt: 8, value: null }))).toEqual({ format: 1, updatedAt: 8, value: null })
    expect(parseHome('{"format":1,"updatedAt":5,"value":{"kind":"screen","route":"_today"}}').value).toEqual({ kind: 'screen', route: '_today' })
    // What this version cannot use counts as no home.
    for (const value of ['"x"', '[1]', '{"kind":"page","id":"../x"}', '{"kind":"screen","route":"_garden"}', '{"kind":"page","id":"p1","__proto__":{"polluted":true}}']) {
      expect(parseHome(`{"format":1,"updatedAt":5,"value":${value}}`).value, value).toBeNull()
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    for (const bad of ['x', '[]', '{"value":null}']) expect(() => parseHome(bad)).toThrow(FormatError)
    expect(() => parseHome('{"format":9,"updatedAt":1,"value":null}')).toThrow(expect.objectContaining({ newer: true }))
  })

  it('merges the home three ways: the later change wins where both devices changed it', () => {
    const at = (updatedAt: number, id: string | null): { updatedAt: number; value: { kind: 'page'; id: string } | null } => ({ updatedAt, value: id === null ? null : { kind: 'page', id } })
    const base = at(1, 'a')
    const local = at(5, 'b')
    const remote = at(9, 'c')
    expect(mergeHome(base, local, null)).toBe(local)
    expect(mergeHome(base, local, base)).toBe(local)
    expect(mergeHome(base, base, remote)).toBe(remote)
    expect(mergeHome(base, local, remote)).toBe(remote)
    expect(mergeHome(base, at(10, 'b'), remote)).toEqual(at(10, 'b'))
    // Clearing is a change like any other.
    expect(mergeHome(base, base, at(4, null))).toEqual(at(4, null))
    expect(mergeHome(base, at(12, null), remote)).toEqual(at(12, null))
    // A device that never had a home takes the workspace's.
    expect(mergeHome(null, at(0, null), remote)).toBe(remote)
  })

  it('takes from a calendars file only https addresses of public hosts, and nothing else', () => {
    const ok = 'https://calendar.google.com/calendar/ical/me/private-TOKEN/basic.ics'
    const text = JSON.stringify({
      format: 1,
      calendars: [
        { url: ok, label: ' Work\u0000 ', color: 'red', enabled: false, updatedAt: 5 },
        { url: 'webcal://p01-caldav.icloud.com/published/2/abc', label: 'x'.repeat(500), color: 'chartreuse', updatedAt: -3 },
        // Whatever the file says, these are refused: plain http, loopback (even the address a development build may read), private networks, local names.
        { url: 'http://example.com/a.ics', label: 'http' },
        { url: 'http://127.0.0.1:8080/a.ics', label: 'dev loopback' },
        { url: 'https://127.0.0.1/a.ics', label: 'loopback' },
        { url: 'https://[::1]/a.ics', label: 'v6 loopback' },
        { url: 'https://localhost/a.ics', label: 'localhost' },
        { url: 'https://192.168.1.2/a.ics', label: 'private' },
        { url: 'https://printer.local/a.ics', label: 'mdns' },
        { url: 'file:///etc/passwd', label: 'file' },
        { url: 'https://user:pass@example.com/a.ics', label: 'credentials' },
        { url: 42 },
        'not an entry'
      ],
      removed: [{ key: 'a'.repeat(64), deletedAt: 9 }, { key: '../x', deletedAt: 1 }, { key: 'A'.repeat(64) }],
      databases: { updatedAt: 7, value: ['db1', '../db', 'db1'] },
      constructor: { prototype: { polluted: true } }
    }).replace('{"url":"https://calendar.google.com', '{"__proto__":{"polluted":true},"url":"https://calendar.google.com')
    expect(text).toContain('__proto__')
    const parsed = parseCalendars(text)
    expect(parsed.calendars).toEqual([
      { url: ok, label: 'Work', color: 'red', enabled: false, updatedAt: 5 },
      { url: 'https://p01-caldav.icloud.com/published/2/abc', label: 'x'.repeat(60), color: 'blue', enabled: true, updatedAt: 0 }
    ])
    expect(parsed.removed).toEqual([{ key: 'a'.repeat(64), deletedAt: 9 }])
    // A list with one bad id is not taken at all.
    expect(parsed.databases).toEqual({ updatedAt: 7, value: null })
    expect(parseCalendars('{"format":1,"databases":{"updatedAt":3,"value":["db1","db1"]}}').databases).toEqual({ updatedAt: 3, value: ['db1'] })
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    for (const entry of parsed.calendars) expect(Object.keys(entry).sort()).toEqual(['color', 'enabled', 'label', 'updatedAt', 'url'])
    // At most eight calendars, the most recently changed.
    const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/${i}.ics`, label: `c${i}`, updatedAt: i }))
    expect(parseCalendars(JSON.stringify({ format: 1, calendars: many })).calendars.map((entry) => entry.label).sort()).toEqual(['c10', 'c11', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'])
    for (const bad of ['x', '[]', '{}', '{"format":"1"}']) expect(() => parseCalendars(bad), bad).toThrow(FormatError)
    expect(() => parseCalendars('{"format":9}')).toThrow(expect.objectContaining({ newer: true }))
    // Round trip, canonical.
    expect(parseCalendars(serializeCalendars(parsed))).toEqual(parsed)
    expect(serializeCalendars(parsed)).toBe(serializeCalendars(parseCalendars(serializeCalendars(parsed))))
  })

  it('merges calendars three ways by address', () => {
    const url = (name: string): string => `https://example.com/${name}.ics`
    const cal = (name: string, updatedAt: number, extra: Partial<SyncedCalendar> = {}): SyncedCalendar => ({ url: url(name), label: name, color: 'blue', enabled: true, updatedAt, ...extra })
    const gone = (name: string, deletedAt: number): { key: string; deletedAt: number } => ({ key: calendarKey(url(name)), deletedAt })
    const file = (calendars: SyncedCalendar[], removed: { key: string; deletedAt: number }[] = [], databases: CalendarsFile['databases'] = { updatedAt: 0, value: null }): CalendarsFile => ({
      calendars,
      removed,
      databases
    })
    const labels = (merged: CalendarsFile): string[] => merged.calendars.map((entry) => entry.label)

    // No remote file: what is here.
    const here = file([cal('a', 1)])
    expect(mergeCalendars(null, here, null)).toBe(here)
    // No base: the union, the later entry where both have one.
    expect(labels(mergeCalendars(null, file([cal('a', 1), cal('b', 5, { label: 'mine' })]), file([cal('b', 7, { label: 'theirs' }), cal('c', 2)])))).toEqual(['a', 'theirs', 'c'])
    expect(labels(mergeCalendars(null, file([cal('b', 9, { label: 'mine' })]), file([cal('b', 7, { label: 'theirs' })])))).toEqual(['mine'])
    // Each field from the side that changed it.
    const base = file([cal('a', 1)])
    const merged = mergeCalendars(base, file([cal('a', 5, { label: 'Renamed here' })]), file([cal('a', 3, { color: 'red', enabled: false })]))
    expect(merged.calendars).toEqual([{ url: url('a'), label: 'Renamed here', color: 'red', enabled: false, updatedAt: 5 }])
    // Both changed the same field: the later edit.
    expect(labels(mergeCalendars(base, file([cal('a', 5, { label: 'L' })]), file([cal('a', 8, { label: 'R' })])))).toEqual(['R'])
    expect(labels(mergeCalendars(base, file([cal('a', 9, { label: 'L' })]), file([cal('a', 8, { label: 'R' })])))).toEqual(['L'])
    // A removal wins over an older edit, and loses to a newer one.
    expect(mergeCalendars(base, file([], [gone('a', 6)]), file([cal('a', 3, { label: 'edited' })]))).toEqual(file([], [gone('a', 6)]))
    expect(labels(mergeCalendars(base, file([], [gone('a', 6)]), file([cal('a', 8, { label: 'edited later' })])))).toEqual(['edited later'])
    expect(mergeCalendars(base, file([cal('a', 1)]), file([], [gone('a', 2)])).calendars).toEqual([])
    // Missing is not removed: a device that lost its calendars takes them back, it does not delete them.
    expect(labels(mergeCalendars(base, file([]), file([cal('a', 1)])))).toEqual(['a'])
    expect(labels(mergeCalendars(base, file([cal('a', 1)]), file([])))).toEqual(['a'])
    // Removed on both: one tombstone, the later.
    expect(mergeCalendars(base, file([], [gone('a', 3)]), file([], [gone('a', 4)])).removed).toEqual([gone('a', 4)])
    // Added again after a removal elsewhere.
    expect(labels(mergeCalendars(file([], [gone('a', 3)]), file([cal('a', 5)]), file([], [gone('a', 3)])))).toEqual(['a'])
    // Never more than the limit.
    const nine = Array.from({ length: 9 }, (_, i) => cal(`n${i}`, i + 1))
    expect(mergeCalendars(null, file(nine.slice(0, 5)), file(nine.slice(5))).calendars).toHaveLength(8)
    // The task databases: the side that changed them, or the later change.
    const dbs = (updatedAt: number, value: string[] | null): CalendarsFile['databases'] => ({ updatedAt, value })
    const withDbs = (databases: CalendarsFile['databases']): CalendarsFile => file([], [], databases)
    expect(mergeCalendars(withDbs(dbs(1, ['x'])), withDbs(dbs(1, ['x'])), withDbs(dbs(4, ['y']))).databases).toEqual(dbs(4, ['y']))
    expect(mergeCalendars(withDbs(dbs(1, ['x'])), withDbs(dbs(3, ['z'])), withDbs(dbs(1, ['x']))).databases).toEqual(dbs(3, ['z']))
    expect(mergeCalendars(withDbs(dbs(1, ['x'])), withDbs(dbs(6, ['z'])), withDbs(dbs(4, ['y']))).databases).toEqual(dbs(6, ['z']))
    expect(mergeCalendars(null, withDbs(dbs(0, null)), withDbs(dbs(4, ['y']))).databases).toEqual(dbs(4, ['y']))
  })
})
