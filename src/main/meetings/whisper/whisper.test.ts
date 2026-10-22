import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { PCM, WHISPER_MODELS } from '../../../shared/meetings'
import { until } from '../../../shared/testing'
import { wavHeader } from '../wav'
import { checkDownloadUrl, DownloadError, downloadVerified, sha256File, type DownloadOptions } from './download'
import { WhisperEngine } from './engine'
import { DOWNLOAD_HOSTS, PINNED, type PinnedFile, type PinnedSet } from './pinned'
import {
  buildWhisperArgs,
  parseProgress,
  parseWhisperJson,
  runWhisper,
  sanitiseStderr,
  WhisperError,
  whisperEnv,
  whisperThreads,
  whisperTimeoutMs,
  type WhisperProgram
} from './run'
import { extractZip, isSafeEntryName, readZipDirectory, ZipError, ZIP_LIMITS } from './zip'

const ROOT = mkdtempSync(join(tmpdir(), 'sel-whisper-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
let serial = 0
const fresh = (name: string): string => {
  const dir = join(ROOT, `${++serial}-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const FAKE: WhisperProgram = { kind: 'node-script', path: fileURLToPath(new URL('./fixtures/fake-whisper.mjs', import.meta.url)) }

// ---- a local server that plays the part of the download hosts ---------------------------

type Route = (request: IncomingMessage, response: ServerResponse) => void
const servers: Server[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.closeAllConnections(), server.close()
})

async function serve(routes: Record<string, Route>): Promise<{ base: string; hits: { path: string; range?: string }[] }> {
  const hits: { path: string; range?: string }[] = []
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0]
    hits.push({ path, ...(request.headers.range ? { range: request.headers.range } : {}) })
    const route = routes[path]
    if (route) route(request, response)
    else response.writeHead(404).end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits }
}

/** Serves `bytes` with support for `Range: bytes=N-`. */
const file =
  (bytes: Buffer, options: { ignoreRange?: boolean; cutAfter?: number } = {}): Route =>
  (request, response) => {
    const match = /^bytes=(\d+)-$/.exec(request.headers.range ?? '')
    const from = match && !options.ignoreRange ? Number(match[1]) : 0
    if (from >= bytes.length && from > 0) return void response.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` }).end()
    const body = bytes.subarray(from)
    response.writeHead(from > 0 ? 206 : 200, {
      'Content-Length': body.length,
      ...(from > 0 ? { 'Content-Range': `bytes ${from}-${bytes.length - 1}/${bytes.length}` } : {})
    })
    if (options.cutAfter !== undefined && from === 0) {
      // Sends a part and drops the connection: a transfer that broke.
      response.write(body.subarray(0, options.cutAfter), () => response.destroy())
    } else response.end(body)
  }

const LOOPBACK: Pick<DownloadOptions, 'hosts' | 'policy'> = { hosts: DOWNLOAD_HOSTS, policy: { allowLoopbackHttp: true } }
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work
  } catch (err) {
    return err instanceof DownloadError ? err.reason : `other: ${String(err)}`
  }
  return 'resolved'
}

describe('the pinned downloads', () => {
  it('names one release, exact sizes and SHA-256 digests for every file', () => {
    const files: PinnedFile[] = [...Object.values(PINNED.programs), ...Object.values(PINNED.models)]
    expect(Object.keys(PINNED.programs)).toContain('win32-x64')
    expect(Object.keys(PINNED.models).sort()).toEqual([...WHISPER_MODELS].sort())
    for (const entry of files) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.size).toBeGreaterThan(1_000_000)
      const url = new URL(entry.url)
      expect(url.protocol).toBe('https:')
      expect(DOWNLOAD_HOSTS.has(url.hostname)).toBe(true)
    }
    // The program comes from one build tag, the models from one revision: neither is "latest".
    for (const program of Object.values(PINNED.programs))
      expect(program.url).toMatch(/^https:\/\/github\.com\/ggml-org\/whisper\.cpp\/releases\/download\/b\d+\/whisper-bin-[\w-]+\.zip$/)
    for (const model of Object.values(PINNED.models))
      expect(model.url).toMatch(/^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\/ggml-[\w.-]+\.bin$/)
    expect(new Set(files.map((entry) => entry.sha256)).size).toBe(files.length)
    // Multilingual models only.
    for (const model of Object.values(PINNED.models)) expect(model.file).not.toMatch(/\.en\./)
  })
})

describe('download addresses', () => {
  const policy = { hosts: DOWNLOAD_HOSTS }
  it('accepts the allow-listed hosts over https and nothing else', () => {
    expect(checkDownloadUrl(PINNED.models.small.url, policy).hostname).toBe('huggingface.co')
    expect(checkDownloadUrl('https://release-assets.githubusercontent.com/x/y?sig=1', policy).hostname).toBe(
      'release-assets.githubusercontent.com'
    )
    for (const url of [
      'http://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
      'https://github.com.evil.example/whisper-bin-x64.zip',
      'https://evil.example/github.com/whisper-bin-x64.zip',
      'https://raw.githubusercontent.com/x',
      'https://sub.huggingface.co/x',
      'https://huggingface.co:8443/x',
      'https://user:pw@github.com/x',
      'https://github.com@evil.example/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'http://127.0.0.1:8080/x',
      'file:///C:/Windows/System32/cmd.exe',
      'ftp://github.com/x'
    ]) {
      expect(() => checkDownloadUrl(url, policy), url).toThrow(DownloadError)
    }
  })
  it('lets the loopback seam through only when it is on', () => {
    expect(checkDownloadUrl('http://127.0.0.1:8080/x', { hosts: DOWNLOAD_HOSTS, policy: { allowLoopbackHttp: true } }).port).toBe('8080')
    expect(() => checkDownloadUrl('http://192.168.1.2:8080/x', { hosts: DOWNLOAD_HOSTS, policy: { allowLoopbackHttp: true } })).toThrow(
      DownloadError
    )
  })
})

describe('downloading a pinned file', () => {
  const bytes = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256))
  const spec = (url: string, overrides: Partial<PinnedFile> = {}): PinnedFile => ({
    url,
    size: bytes.length,
    sha256: sha256(bytes),
    ...overrides
  })

  it('downloads, verifies and renames into place, reporting progress', async () => {
    const { base } = await serve({ '/model.bin': file(bytes) })
    const target = join(fresh('ok'), 'model.bin')
    const seen: number[] = []
    await downloadVerified(spec(`${base}/model.bin`), target, { ...LOOPBACK, onProgress: (received) => seen.push(received) })
    expect(readFileSync(target).equals(bytes)).toBe(true)
    expect(existsSync(`${target}.part`)).toBe(false)
    expect(seen[seen.length - 1]).toBe(bytes.length)
    expect(await sha256File(target)).toBe(sha256(bytes))
  })

  it('continues an interrupted transfer with a Range request', async () => {
    const { base, hits } = await serve({ '/model.bin': file(bytes, { cutAfter: 100_000 }) })
    const target = join(fresh('resume'), 'model.bin')
    expect(await reason(downloadVerified(spec(`${base}/model.bin`), target, LOOPBACK))).toBe('offline')
    const have = statSync(`${target}.part`).size
    expect(have).toBeGreaterThan(0)
    expect(have).toBeLessThan(bytes.length)
    expect(existsSync(target)).toBe(false)
    await downloadVerified(spec(`${base}/model.bin`), target, LOOPBACK)
    expect(readFileSync(target).equals(bytes)).toBe(true)
    expect(hits[1].range).toBe(`bytes=${have}-`)
  })

  it('starts over when the server ignores the range', async () => {
    const { base } = await serve({ '/model.bin': file(bytes, { ignoreRange: true }) })
    const target = join(fresh('norange'), 'model.bin')
    writeFileSync(`${target}.part`, bytes.subarray(0, 1000))
    await downloadVerified(spec(`${base}/model.bin`), target, LOOPBACK)
    expect(readFileSync(target).equals(bytes)).toBe(true)
  })

  it('deletes a file whose digest is not the pinned one', async () => {
    const { base } = await serve({ '/model.bin': file(bytes) })
    const target = join(fresh('digest'), 'model.bin')
    const failure = await downloadVerified(spec(`${base}/model.bin`, { sha256: '0'.repeat(64) }), target, LOOPBACK).catch(
      (err: unknown) => err
    )
    expect(failure).toBeInstanceOf(DownloadError)
    expect((failure as DownloadError).reason).toBe('digest-mismatch')
    expect((failure as DownloadError).message).toMatch(/checksum/)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(`${target}.part`)).toBe(false)
  })

  it('does not trust a resumed part either: a tampered start fails the digest', async () => {
    const { base } = await serve({ '/model.bin': file(bytes) })
    const target = join(fresh('tamper'), 'model.bin')
    writeFileSync(`${target}.part`, Buffer.alloc(1000, 0xee))
    expect(await reason(downloadVerified(spec(`${base}/model.bin`), target, LOOPBACK))).toBe('digest-mismatch')
    expect(existsSync(target)).toBe(false)
  })

  it('refuses a file longer than the pinned size, declared or not', async () => {
    const longer = Buffer.concat([bytes, Buffer.from('more')])
    const { base } = await serve({
      '/declared.bin': file(longer),
      '/chunked.bin': (_request, response) => {
        response.writeHead(200)
        response.end(longer)
      }
    })
    for (const name of ['declared', 'chunked']) {
      const target = join(fresh(name), 'model.bin')
      expect(await reason(downloadVerified(spec(`${base}/${name}.bin`), target, LOOPBACK))).toBe('too-large')
      expect(existsSync(target)).toBe(false)
      expect(existsSync(`${target}.part`)).toBe(false)
    }
  })

  it('follows redirects only to allowed places', async () => {
    const { base } = await serve({
      '/model.bin': file(bytes),
      '/hop': (_request, response) => void response.writeHead(302, { Location: '/model.bin' }).end(),
      '/out': (_request, response) => void response.writeHead(302, { Location: 'https://evil.example/model.bin' }).end(),
      '/plain': (_request, response) => void response.writeHead(302, { Location: 'http://github.com/model.bin' }).end(),
      '/local': (_request, response) => void response.writeHead(302, { Location: 'https://localhost/model.bin' }).end(),
      '/loop': (_request, response) => void response.writeHead(302, { Location: '/loop' }).end()
    })
    const ok = join(fresh('redirect'), 'model.bin')
    await downloadVerified(spec(`${base}/hop`), ok, LOOPBACK)
    expect(readFileSync(ok).equals(bytes)).toBe(true)
    const refused = await downloadVerified(spec(`${base}/out`), join(fresh('out'), 'm.bin'), LOOPBACK).catch((err: unknown) => err)
    expect((refused as DownloadError).reason).toBe('blocked-host')
    // The message names the host that was refused, and nothing else of the address.
    expect((refused as DownloadError).message).toContain('evil.example')
    expect(await reason(downloadVerified(spec(`${base}/plain`), join(fresh('plain'), 'm.bin'), LOOPBACK))).toBe('blocked-host')
    expect(await reason(downloadVerified(spec(`${base}/local`), join(fresh('local'), 'm.bin'), LOOPBACK))).toBe('blocked-host')
    expect(await reason(downloadVerified(spec(`${base}/loop`), join(fresh('loop'), 'm.bin'), LOOPBACK))).toBe('failed')
  })

  it('refuses a host whose address is not public, before connecting', async () => {
    const connected: string[] = []
    const work = downloadVerified({ url: 'https://github.com/x.zip', size: 10, sha256: '0'.repeat(64) }, join(fresh('private'), 'x.zip'), {
      hosts: DOWNLOAD_HOSTS,
      resolve: async (host) => {
        connected.push(host)
        return [{ address: '10.0.0.5', family: 4 }]
      }
    })
    expect(await reason(work)).toBe('blocked-host')
    expect(connected).toEqual(['github.com'])
  })

  it('can be cancelled, and keeps the part for next time', async () => {
    const { base } = await serve({
      '/slow.bin': (_request, response) => {
        response.writeHead(200, { 'Content-Length': bytes.length })
        response.write(bytes.subarray(0, 50_000))
      }
    })
    const target = join(fresh('cancel'), 'model.bin')
    const abort = new AbortController()
    const work = downloadVerified(spec(`${base}/slow.bin`), target, {
      ...LOOPBACK,
      signal: abort.signal,
      onProgress: (received) => received >= 50_000 && abort.abort()
    })
    expect(await reason(work)).toBe('cancelled')
    expect(existsSync(target)).toBe(false)
    expect(statSync(`${target}.part`).size).toBe(50_000)
  })

  it('stops when the transfer goes quiet', async () => {
    const { base } = await serve({ '/stall.bin': (_request, response) => void response.writeHead(200, { 'Content-Length': bytes.length }) })
    expect(await reason(downloadVerified(spec(`${base}/stall.bin`), join(fresh('stall'), 'm.bin'), { ...LOOPBACK, idleMs: 150 }))).toBe(
      'timeout'
    )
  })

  it('does not start without room on the disk, and reports a missing file', async () => {
    const { base, hits } = await serve({})
    expect(
      await reason(downloadVerified(spec(`${base}/model.bin`), join(fresh('full'), 'm.bin'), { ...LOOPBACK, freeBytes: async () => 1024 }))
    ).toBe('disk-full')
    expect(hits).toHaveLength(0)
    expect(await reason(downloadVerified(spec(`${base}/gone.bin`), join(fresh('gone'), 'm.bin'), LOOPBACK))).toBe('not-found')
  })
})

// ---- zip ----------------------------------------------------------------------------------

interface TestEntry {
  name: string
  data: Buffer
  stored?: boolean
  /** Unix mode bits, with "made by Unix". */
  mode?: number
  /** The size the directory claims the entry inflates to. */
  claim?: number
  flags?: number
}

function makeZip(entries: TestEntry[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const packed = entry.stored ? entry.data : deflateRawSync(entry.data)
    const size = entry.claim ?? entry.data.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.flags ?? 0, 6)
    local.writeUInt16LE(entry.stored ? 0 : 8, 8)
    local.writeUInt32LE(crc32(entry.data), 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, packed)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(entry.mode !== undefined ? (3 << 8) | 20 : 20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(entry.flags ?? 0, 8)
    header.writeUInt16LE(entry.stored ? 0 : 8, 10)
    header.writeUInt32LE(crc32(entry.data), 16)
    header.writeUInt32LE(packed.length, 20)
    header.writeUInt32LE(size, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(entry.mode !== undefined ? (entry.mode << 16) >>> 0 : 0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)
    offset += 30 + name.length + packed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

describe('unpacking the program archive', () => {
  const exe = Buffer.from('MZ fake program '.repeat(200))
  const dll = Buffer.from('MZ fake library '.repeat(100))
  const release = makeZip([
    { name: 'Release/', data: Buffer.alloc(0), stored: true },
    { name: 'Release/whisper-cli.exe', data: exe },
    { name: 'Release/whisper.dll', data: dll },
    { name: 'Release/ggml.dll', data: dll, stored: true },
    { name: 'Release/whisper-server.exe', data: exe },
    { name: 'docs/readme.txt', data: Buffer.from('hello') }
  ])
  const all = (entry: { name: string }): string | null => entry.name.split('/').pop() ?? null

  it('reads the directory and writes only what was asked for, flat', async () => {
    expect(readZipDirectory(release).map((entry) => entry.name)).toEqual([
      'Release/whisper-cli.exe',
      'Release/whisper.dll',
      'Release/ggml.dll',
      'Release/whisper-server.exe',
      'docs/readme.txt'
    ])
    const dir = join(fresh('zip'), 'out')
    const written = await extractZip(release, dir, (entry) =>
      /whisper-cli\.exe$|\.dll$/.test(entry.name) ? (entry.name.split('/').pop() ?? null) : null
    )
    expect(written.sort()).toEqual(['ggml.dll', 'whisper-cli.exe', 'whisper.dll'])
    expect(readdirSync(dir).sort()).toEqual(['ggml.dll', 'whisper-cli.exe', 'whisper.dll'])
    expect(readFileSync(join(dir, 'whisper-cli.exe')).equals(exe)).toBe(true)
    expect(readFileSync(join(dir, 'ggml.dll')).equals(dll)).toBe(true)
  })

  it.each([
    ['a climbing path', '../evil.exe'],
    ['a climbing path further in', 'Release/../../evil.exe'],
    ['an absolute path', '/etc/passwd'],
    ['a drive path', 'C:/Windows/evil.exe'],
    ['a backslash path', 'Release\\..\\evil.exe'],
    ['a UNC path', '\\\\server\\share\\evil.exe'],
    ['a dot segment', './whisper-cli.exe']
  ])('refuses the whole archive for %s', async (_name, entryName) => {
    expect(isSafeEntryName(entryName)).toBe(false)
    const archive = makeZip([
      { name: 'Release/whisper-cli.exe', data: exe },
      { name: entryName, data: Buffer.from('evil') }
    ])
    const dir = join(fresh('traversal'), 'out')
    await expect(extractZip(archive, dir, all)).rejects.toBeInstanceOf(ZipError)
    // Nothing at all was written: the good entry before the bad one did not get out either.
    expect(existsSync(dir)).toBe(false)
  })

  it('refuses symbolic links and encrypted entries', () => {
    expect(() => readZipDirectory(makeZip([{ name: 'whisper-cli.exe', data: Buffer.from('/bin/sh'), mode: 0o120777 }]))).toThrow(
      /symbolic link/
    )
    expect(() => readZipDirectory(makeZip([{ name: 'whisper-cli.exe', data: exe, flags: 1 }]))).toThrow(/encrypted/)
    // An ordinary Unix file is fine.
    expect(readZipDirectory(makeZip([{ name: 'whisper-cli', data: exe, mode: 0o100755 }]))).toHaveLength(1)
  })

  it('refuses a bomb: more than it declares, more than its ratio, more than the cap', async () => {
    const zeros = Buffer.alloc(8 * 1024 * 1024)
    // Says 100 bytes, inflates to 8 MB.
    await expect(extractZip(makeZip([{ name: 'a.dll', data: zeros, claim: 100 }]), join(fresh('bomb1'), 'out'), all)).rejects.toThrow(
      /unpack|size/
    )
    // Says the truth, but 8 MB out of 8 kB is beyond any real program.
    await expect(extractZip(makeZip([{ name: 'a.dll', data: zeros }]), join(fresh('bomb2'), 'out'), all)).rejects.toThrow(/far more/)
    // Many entries that together pass the cap: refused before anything is inflated.
    const big = { name: 'x.dll', data: Buffer.alloc(16), claim: ZIP_LIMITS.extractedBytes / 2 + 1 }
    await expect(extractZip(makeZip([big, { ...big, name: 'y.dll' }]), join(fresh('bomb3'), 'out'), all)).rejects.toThrow(/far more/)
  })

  it('refuses damage, duplicates and things that are not zips', async () => {
    const damaged = Buffer.from(release)
    damaged[40] ^= 0xff
    await expect(extractZip(damaged, join(fresh('crc'), 'out'), all)).rejects.toBeInstanceOf(ZipError)
    await expect(
      extractZip(
        makeZip([
          { name: 'a/x.dll', data: dll },
          { name: 'b/X.DLL', data: dll }
        ]),
        join(fresh('dup'), 'out'),
        all
      )
    ).rejects.toThrow(/same name/)
    expect(() => readZipDirectory(Buffer.from('this is not an archive, just some text that is long enough'))).toThrow(/not a zip/)
    expect(() => readZipDirectory(release.subarray(0, release.length - 30))).toThrow(ZipError)
  })
})

// ---- the program --------------------------------------------------------------------------

describe('whisper-cli arguments and output', () => {
  it('builds the argument array', () => {
    expect(
      buildWhisperArgs({ model: 'C:\\m\\ggml-small.bin', input: 'C:\\r\\mic.wav', outputBase: 'C:\\r\\mic', language: 'auto', threads: 4 })
    ).toEqual(['-m', 'C:\\m\\ggml-small.bin', '-f', 'C:\\r\\mic.wav', '-l', 'auto', '-t', '4', '-oj', '-of', 'C:\\r\\mic', '-pp', '-np'])
    const odd = buildWhisperArgs({ model: 'm', input: 'i', outputBase: 'o', language: 'pt; rm -rf', threads: 999 })
    expect(odd[odd.indexOf('-l') + 1]).toBe('auto')
    expect(odd[odd.indexOf('-t') + 1]).toBe('64')
    expect(buildWhisperArgs({ model: 'm', input: 'i', outputBase: 'o', language: 'pt', threads: 0 })).toContain('pt')
    // Never translated: the transcript stays in the language that was spoken.
    expect(odd).not.toContain('-tr')
    expect(odd).not.toContain('--translate')
  })

  it('picks threads and a timeout', () => {
    expect(whisperThreads(1)).toBe(1)
    expect(whisperThreads(4)).toBe(1)
    expect(whisperThreads(8)).toBe(3)
    expect(whisperThreads(16)).toBe(7)
    expect(whisperThreads(64)).toBe(8)
    expect(whisperTimeoutMs(600)).toBe(120_000 + 600 * 6000)
  })

  it('reads progress lines', () => {
    expect(parseProgress('whisper_print_progress_callback: progress =  45%')).toBe(45)
    expect(parseProgress('whisper_print_progress_callback: progress = 100%')).toBe(100)
    expect(parseProgress('progress = 250%')).toBe(100)
    expect(parseProgress('whisper_init_from_file_with_params_no_state: loading model')).toBeNull()
  })

  // The shape `-oj` writes (examples/cli/cli.cpp, output_json), trimmed to what matters.
  const sample = JSON.stringify({
    systeminfo: 'AVX = 1 | AVX2 = 1',
    model: { type: 'small', multilingual: true, vocab: 51865 },
    params: { model: 'models/ggml-small.bin', language: 'auto', translate: false },
    result: { language: 'pt' },
    transcription: [
      { timestamps: { from: '00:00:00,000', to: '00:00:04,500' }, offsets: { from: 0, to: 4500 }, text: ' Bom dia a todos.' },
      { timestamps: { from: '00:00:04,500', to: '00:00:09,120' }, offsets: { from: 4500, to: 9120 }, text: ' Vamos começar pela agenda.' },
      { timestamps: { from: '00:01:02,000', to: '00:01:03,250' }, text: ' [BLANK_AUDIO]' }
    ]
  })

  it('parses the JSON the program writes', () => {
    const output = parseWhisperJson(sample)
    expect(output.language).toBe('pt')
    expect(output.segments).toEqual([
      { start: 0, end: 4.5, text: ' Bom dia a todos.' },
      { start: 4.5, end: 9.12, text: ' Vamos começar pela agenda.' },
      // Without offsets the timestamps are read.
      { start: 62, end: 63.25, text: ' [BLANK_AUDIO]' }
    ])
    expect(parseWhisperJson('{"transcription":[]}')).toEqual({ language: null, segments: [] })
    expect(() => parseWhisperJson('{ "transcription": [')).toThrow(/not JSON/)
    expect(() => parseWhisperJson('{"result":{}}')).toThrow(/does not understand/)
    expect(
      parseWhisperJson('{"result":{"language":"../x"},"transcription":[{"text":5},{"offsets":{"from":-1,"to":2},"text":"x"},null]}')
    ).toEqual({ language: null, segments: [] })
  })

  it('cleans what the program says before anybody sees it', () => {
    expect(sanitiseStderr('\u001b[31merror\u001b[0m: failed to open C:\\Users\\ana\\AppData\\Roaming\\sel\\recordings\\x\\mic.wav\n')).toBe(
      'error: failed to open …'
    )
    expect(
      sanitiseStderr('whisper_print_progress_callback: progress =  45%\nerror: out of memory at /home/ana/.cache/whisper/model.bin\n')
    ).toBe('error: out of memory at …')
    expect(sanitiseStderr('')).toBeUndefined()
  })

  it('gives the program a minimal environment', () => {
    const env = whisperEnv(
      {
        SystemRoot: 'C:\\Windows',
        PATH: 'C:\\evil;C:\\tools',
        ANTHROPIC_API_KEY: 'secret',
        GITHUB_TOKEN: 'secret',
        TEMP: 'C:\\Temp',
        HOME: '/home/x'
      },
      'win32'
    )
    expect(env['PATH']).toBe('C:\\Windows\\System32;C:\\Windows')
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH', 'SystemRoot', 'TEMP'])
  })
})

function makeWav(file: string, seconds: number, amplitude = 0.3): void {
  const samples = new Int16Array(Math.round(seconds * PCM.sampleRate))
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin((i / PCM.sampleRate) * 2 * Math.PI * 300) * amplitude * 32767)
  writeFileSync(file, Buffer.concat([wavHeader(samples.byteLength), Buffer.from(samples.buffer)]))
}

function setup(mode = ''): { dir: string; args: { model: string; input: string; outputBase: string; language: string; threads: number } } {
  const dir = fresh('run')
  writeFileSync(join(dir, 'model.bin'), 'fake model')
  makeWav(join(dir, 'mic.wav'), 12)
  if (mode) writeFileSync(join(dir, 'fake-whisper'), mode)
  return {
    dir,
    args: { model: join(dir, 'model.bin'), input: join(dir, 'mic.wav'), outputBase: join(dir, 'mic.out'), language: 'auto', threads: 2 }
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const gone = (pid: number): Promise<boolean> => until(() => !alive(pid), { timeout: 30_000, interval: 100 }).catch(() => false)
const failure = async (work: Promise<unknown>): Promise<WhisperError> => {
  try {
    await work
  } catch (err) {
    if (err instanceof WhisperError) return err
    throw err
  }
  throw new Error('resolved')
}

// Each test spawns the stand-in through Node. Alone a run takes a tenth of a second; under the
// whole suite's load (and on CI's Windows runner) starting a process can take many seconds. A run
// that is meant to finish gets a wide margin: one that hangs still fails, on its own timeout.
const RUN_MS = 60_000

describe('running the program (against the stand-in)', () => {
  it('transcribes a file, reports progress and leaves no result file behind', async () => {
    const { dir, args } = setup()
    const seen: number[] = []
    const output = await runWhisper({ program: FAKE, args, cwd: dir, timeoutMs: RUN_MS, onProgress: (percent) => seen.push(percent) })
    expect(output.language).toBe('en')
    expect(output.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 5],
      [5, 10],
      [10, 12]
    ])
    expect(output.segments[0].text).toContain('I said something')
    expect(seen[0]).toBe(5)
    expect(seen[seen.length - 1]).toBe(100)
    expect(existsSync(`${args.outputBase}.json`)).toBe(false)
  }, 90_000)

  it('passes the language on', async () => {
    const { dir, args } = setup()
    const output = await runWhisper({ program: FAKE, args: { ...args, language: 'pt' }, cwd: dir, timeoutMs: RUN_MS })
    expect(output.language).toBe('pt')
    expect(output.segments[0].text).toContain('em português')
  }, 90_000)

  it('reports a failure with one sanitised line', async () => {
    const { dir, args } = setup('error')
    const err = await failure(runWhisper({ program: FAKE, args, cwd: dir, timeoutMs: RUN_MS }))
    expect(err.reason).toBe('failed')
    expect(err.detail).toBe('error: failed to process audio at …')
    expect(err.detail).not.toContain('secret')
    const missing = await failure(
      runWhisper({ program: FAKE, args: { ...args, model: join(dir, 'nope.bin') }, cwd: dir, timeoutMs: RUN_MS })
    )
    expect(missing.reason).toBe('failed')
  }, 90_000)

  it('stops a run that takes too long, with everything it started', async () => {
    const { dir, args } = setup('hang-tree')
    const err = await failure(runWhisper({ program: FAKE, args, cwd: dir, timeoutMs: 1500 }))
    expect(err.reason).toBe('timeout')
    const pids = readFileSync(join(dir, 'fake-whisper-pids'), 'utf8').split(',').map(Number)
    expect(pids).toHaveLength(2)
    for (const pid of pids) expect(await gone(pid)).toBe(true)
  }, 90_000)

  it('kills the program when cancelled', async () => {
    const { dir, args } = setup('hang')
    const abort = new AbortController()
    let pid = 0
    const work = runWhisper({
      program: FAKE,
      args,
      cwd: dir,
      timeoutMs: 60_000,
      signal: abort.signal,
      onSpawn: (child) => (pid = child.pid ?? 0),
      onProgress: () => abort.abort()
    })
    const err = await failure(work)
    expect(err.reason).toBe('cancelled')
    expect(pid).toBeGreaterThan(0)
    expect(await gone(pid)).toBe(true)
    // Already cancelled: nothing is started.
    expect((await failure(runWhisper({ program: FAKE, args, cwd: dir, timeoutMs: 1000, signal: abort.signal }))).reason).toBe('cancelled')
  }, 90_000)

  it('survives megabytes of output and refuses a result that is too large or not JSON', async () => {
    const huge = setup('huge')
    expect((await failure(runWhisper({ program: FAKE, args: huge.args, cwd: huge.dir, timeoutMs: 30_000 }))).reason).toBe('failed')
    expect(existsSync(`${huge.args.outputBase}.json`)).toBe(false)
    const bad = setup('bad-json')
    const err = await failure(runWhisper({ program: FAKE, args: bad.args, cwd: bad.dir, timeoutMs: RUN_MS }))
    expect(err.reason).toBe('failed')
    expect(err.detail).toMatch(/not JSON/)
  }, 120_000)

  it('says so when the program cannot be started', async () => {
    const { dir, args } = setup()
    const err = await failure(
      runWhisper({ program: { kind: 'exe', path: join(dir, 'no-such-program.exe') }, args, cwd: dir, timeoutMs: 5000 })
    )
    expect(err.reason).toBe('not-found')
  })
})

// ---- the engine ---------------------------------------------------------------------------

describe('the engine', () => {
  const exe = Buffer.from('MZ not really a program '.repeat(50))
  const archive = makeZip([
    { name: 'Release/whisper-cli.exe', data: exe },
    { name: 'Release/whisper.dll', data: Buffer.from('dll one '.repeat(40)) },
    { name: 'Release/SDL2.dll', data: Buffer.from('dll two '.repeat(40)) },
    { name: 'Release/whisper-bench.exe', data: exe },
    { name: 'other/extra.dll', data: Buffer.from('elsewhere '.repeat(40)) }
  ])
  const model = Buffer.alloc(2 * 1024 * 1024, 7)

  function pins(base: string, overrides: Partial<PinnedFile> = {}): PinnedSet {
    const one = (name: string): PinnedFile & { file: string } => ({
      file: `ggml-${name}.bin`,
      url: `${base}/ggml-${name}.bin`,
      size: model.length,
      sha256: sha256(model),
      ...overrides
    })
    return {
      version: '9.9.9',
      programs: { 'test-x64': { url: `${base}/whisper-bin-x64.zip`, size: archive.length, sha256: sha256(archive) } },
      models: { base: one('base'), small: one('small'), medium: one('medium'), 'large-v3-turbo': one('large-v3-turbo') }
    }
  }

  function engine(
    base: string,
    extra: Partial<ConstructorParameters<typeof WhisperEngine>[0]> = {}
  ): { engine: WhisperEngine; settings: Map<string, unknown>; dir: string; events: unknown[] } {
    const settings = new Map<string, unknown>()
    const dir = join(fresh('engine'), 'whisper')
    const events: unknown[] = []
    return {
      settings,
      dir,
      events,
      engine: new WhisperEngine({
        dir,
        getSetting: (key) => settings.get(key) ?? null,
        setSetting: (key, value) => void (value === null ? settings.delete(key) : settings.set(key, value)),
        platformKey: 'test-x64',
        programName: 'whisper-cli.exe',
        pins: pins(base),
        policy: { allowLoopbackHttp: true },
        onDownload: (state, outcome) => events.push(state ?? outcome),
        ...extra
      })
    }
  }

  it('starts out not installed, and says what a download would fetch', async () => {
    const { engine: target } = engine('http://127.0.0.1:1')
    const status = await target.status()
    expect(status.state).toBe('missing-program')
    expect(status.canDownload).toBe(true)
    expect(status.offer).toMatchObject({ version: '9.9.9', programBytes: archive.length })
    expect(status.offer.models.small).toBe(model.length)
    expect(await target.locate()).toBeNull()
  })

  it('offers no download where no digest is pinned', async () => {
    const { engine: target } = engine('http://127.0.0.1:1', { platformKey: 'darwin-arm64' })
    const status = await target.status()
    expect(status).toMatchObject({ state: 'unsupported', canDownload: false })
    expect((await target.install('small')).error).toMatch(/cannot download/)
  })

  it('downloads the program and a model, keeps only the program and its libraries', async () => {
    const { base, hits } = await serve({
      '/whisper-bin-x64.zip': file(archive),
      '/ggml-small.bin': file(model),
      '/ggml-base.bin': file(model)
    })
    const { engine: target, settings, dir, events } = engine(base)
    const status = await target.install('small')
    expect(status.state).toBe('ready')
    expect(status.program).toEqual({ path: join(dir, '9.9.9', 'whisper-cli.exe'), managed: true, version: '9.9.9' })
    expect(status.model).toMatchObject({ managed: true, id: 'small', bytes: model.length })
    expect(readdirSync(join(dir, '9.9.9')).sort()).toEqual(['SDL2.dll', 'whisper-cli.exe', 'whisper.dll'])
    expect(readdirSync(dir).sort()).toEqual(['9.9.9', 'models'])
    expect(settings.get('meetings.model')).toBe('small')
    expect(events.some((event) => (event as { phase?: string }).phase === 'model')).toBe(true)
    expect(events[events.length - 1]).toEqual({ ok: true })
    expect(await target.locate()).toEqual({
      program: { kind: 'exe', path: join(dir, '9.9.9', 'whisper-cli.exe') },
      model: join(dir, 'models', 'ggml-small.bin')
    })
    // A second model fetches only that model.
    const before = hits.length
    expect((await target.install('base')).model?.id).toBe('base')
    expect(hits.slice(before).map((hit) => hit.path)).toEqual(['/ggml-base.bin'])
    // The model asked for in settings wins; one that is missing falls back to what is there.
    settings.set('meetings.model', 'medium')
    expect((await target.status()).model?.id).toBe('base')
    expect(await target.storageBytes()).toBeGreaterThan(model.length * 2)
    // Remove: everything sel put there goes.
    expect((await target.remove()).state).toBe('missing-program')
    expect(existsSync(dir)).toBe(false)
  })

  it('keeps nothing of a download that does not match its digest', async () => {
    const { base } = await serve({
      '/whisper-bin-x64.zip': file(Buffer.concat([archive.subarray(0, 60), Buffer.from([archive[60] ^ 0xff]), archive.subarray(61)]))
    })
    const { engine: target, dir, events } = engine(base)
    const status = await target.install('small')
    expect(status.state).toBe('missing-program')
    expect(status.error).toMatch(/checksum/)
    expect(existsSync(join(dir, '9.9.9'))).toBe(false)
    expect(readdirSync(dir)).toEqual([])
    expect(events[events.length - 1]).toMatchObject({ ok: false })
  })

  it('refuses an unknown model and a second download at once', async () => {
    const { base } = await serve({
      '/whisper-bin-x64.zip': (_request, response) => void response.writeHead(200, { 'Content-Length': archive.length })
    })
    const { engine: target } = engine(base)
    await expect(target.install('tiny.en')).rejects.toThrow(/Unknown model/)
    const first = target.install('small')
    await until(async () => (await target.status()).download, { what: 'the download to start' })
    await expect(target.install('small')).rejects.toThrow(/already running/)
    target.cancelDownload()
    const status = await first
    // Cancelling is not an error to show.
    expect(status.error).toBeUndefined()
    expect(status.download).toBeNull()
  })

  it('prefers a program and a model the user chose, and a development stand-in over both', async () => {
    const { engine: target, settings, dir } = engine('http://127.0.0.1:1', { devProgram: FAKE.path })
    const chosenModel = join(fresh('chosen'), 'my-model.bin')
    writeFileSync(chosenModel, model)
    expect(await target.useModel(chosenModel)).toBe(true)
    expect(await target.useModel(join(dir, 'missing.bin'))).toBe(false)
    expect(settings.get('meetings.modelPath')).toBe(chosenModel)
    const status = await target.status()
    expect(status.state).toBe('ready')
    expect(status.model).toMatchObject({ path: chosenModel, managed: false, id: null })
    expect(await target.locate()).toEqual({ program: { kind: 'node-script', path: FAKE.path }, model: chosenModel })
    // Something that is not whisper-cli is not kept as the program.
    expect(await target.useProgram(chosenModel)).toBe(false)
    expect(settings.has('meetings.whisperPath')).toBe(false)
  })
})
