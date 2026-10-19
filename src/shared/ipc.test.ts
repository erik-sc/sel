import { describe, expect, it } from 'vitest'
import { INVOKE, type InvokeChannel } from './api'
import { buildInvokers, channelPath, type InvokeChannels, type Invokers } from './ipc'

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
const assertType = <T extends true>(): T => true as T

interface Sample {
  clientId: string
  notes: {
    get(id: string): Promise<string>
    tag: { add(name: string): Promise<void> }
    ping(): void
    onChange(listener: () => void): () => void
    limits: { size: number }
  }
  quiet: { onEvent(listener: () => void): () => void }
  onCommand(listener: () => void): () => void
}

describe('invoke channels as types', () => {
  it('are the methods that return a promise, nested with a dot', () => {
    assertType<Equal<InvokeChannels<Sample>, 'notes:get' | 'notes:tag.add'>>()
    assertType<Equal<Invokers<Sample>, { notes: { get(id: string): Promise<string>; tag: { add(name: string): Promise<void> } } }>>()
  })

  it('make a missing or an extra line in INVOKE a type error', () => {
    const { 'blocks:get': _dropped, ...rest } = INVOKE
    // @ts-expect-error: `blocks:get` is a method of Api without its line
    const missing: Record<InvokeChannel, true> = rest
    // @ts-expect-error: `blocks:nope` is no method of Api
    const extra: Record<InvokeChannel, true> = { ...INVOKE, 'blocks:nope': true }
    expect(Object.keys(missing).length + 2).toBe(Object.keys(extra).length)
  })
})

describe('buildInvokers', () => {
  const call =
    (channel: string) =>
    async (...args: unknown[]) => ({ channel, args })

  it('puts each channel at the place it names, calling for that channel only', async () => {
    const api = buildInvokers(['notes:get', 'notes:tag.add', 'other:list'], call) as {
      notes: { get(...a: unknown[]): Promise<unknown>; tag: { add(...a: unknown[]): Promise<unknown> } }
      other: { list(): Promise<unknown> }
    }
    expect(Object.keys(api)).toEqual(['notes', 'other'])
    expect(Object.keys(api.notes)).toEqual(['get', 'tag'])
    await expect(api.notes.get('a')).resolves.toEqual({ channel: 'notes:get', args: ['a'] })
    await expect(api.notes.tag.add('b', 2)).resolves.toEqual({ channel: 'notes:tag.add', args: ['b', 2] })
    await expect(api.other.list()).resolves.toEqual({ channel: 'other:list', args: [] })
  })

  it('builds every declared channel', () => {
    expect(() => buildInvokers(Object.keys(INVOKE), call)).not.toThrow()
  })

  it('refuses malformed channels and two channels that claim one place', () => {
    for (const bad of [
      'notes',
      ':get',
      'notes:',
      'notes:get.',
      'notes:__proto__',
      'notes:constructor.x',
      'no tes:get',
      'notes:a-b',
      'a:b:c'
    ])
      expect(() => channelPath(bad), bad).toThrow('Invalid invoke channel')
    expect(() => buildInvokers(['notes:get', 'notes:get'], call)).toThrow('collides')
    expect(() => buildInvokers(['notes:tag', 'notes:tag.add'], call)).toThrow('collides')
    expect(() => buildInvokers(['notes:tag.add', 'notes:tag'], call)).toThrow('collides')
  })

  it('reads a channel as its path on the api', () => {
    expect(channelPath('blocks:get')).toEqual(['blocks', 'get'])
    expect(channelPath('meetings:recording.begin')).toEqual(['meetings', 'recording', 'begin'])
  })
})
