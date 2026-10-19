/**
 * How an invoke call's channel and its place on `window.api` follow from one another, as types
 * and as one small pure function. Free of Electron: the preload builds the bridge with it and
 * main types its handlers with it (see `INVOKE` in ./api.ts for the declared channels).
 *
 * The rule: the method `api.<namespace>.<a>.<b>` answers on the channel `<namespace>:<a>.<b>`,
 * and every method that returns a promise is an invoke call. Methods that return nothing are
 * fire-and-forget sends, `on*` methods that return an unsubscribe function are events, and
 * other members are plain values: those stay hand-written in the preload.
 */

type AnyFunction = (...args: never[]) => unknown
type InvokeFunction = (...args: never[]) => Promise<unknown>

/** The dotted paths of the invoke methods in `T`, each prefixed with `P`. */
type InvokePaths<T, P extends string> = {
  [K in keyof T & string]: T[K] extends InvokeFunction
    ? `${P}${K}`
    : T[K] extends AnyFunction
      ? never
      : T[K] extends object
        ? InvokePaths<T[K], `${P}${K}.`>
        : never
}[keyof T & string]

/** The invoke channels of an api: `blocks.get` becomes `blocks:get`, `ai.agents.list` becomes `ai:agents.list`. */
export type InvokeChannels<T> = {
  [K in keyof T & string]: T[K] extends AnyFunction ? never : T[K] extends object ? `${K}:${InvokePaths<T[K], ''>}` : never
}[keyof T & string]

/** `T` with only its invoke methods, and the namespaces that hold any: what the preload builds from the channels. */
export type Invokers<T> = {
  [K in keyof T as T[K] extends InvokeFunction
    ? K
    : T[K] extends AnyFunction
      ? never
      : T[K] extends object
        ? [InvokePaths<T[K], ''>] extends [never]
          ? never
          : K
        : never]: T[K] extends InvokeFunction ? T[K] : Invokers<T[K]>
}

const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/

/** Where a channel's method sits on the api: `meetings:recording.begin` gives `['meetings', 'recording', 'begin']`. */
export function channelPath(channel: string): string[] {
  const colon = channel.indexOf(':')
  const path = colon > 0 ? [channel.slice(0, colon), ...channel.slice(colon + 1).split('.')] : []
  if (path.length < 2 || !path.every((segment) => SEGMENT.test(segment) && !(segment in Object.prototype)))
    throw new Error(`Invalid invoke channel: ${channel}`)
  return path
}

/**
 * The nested object of invoke methods for these channels, each made by `call` for its own
 * channel and for no other. Throws on a malformed channel, or on two that claim the same place.
 */
export function buildInvokers(
  channels: readonly string[],
  call: (channel: string) => (...args: unknown[]) => Promise<unknown>
): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const channel of channels) {
    const path = channelPath(channel)
    const name = path.pop() as string
    let node = root
    for (const segment of path) {
      const next = Object.hasOwn(node, segment) ? node[segment] : (node[segment] = {})
      if (typeof next !== 'object' || next === null) throw new Error(`Invoke channel ${channel} collides with another`)
      node = next as Record<string, unknown>
    }
    if (Object.hasOwn(node, name)) throw new Error(`Invoke channel ${channel} collides with another`)
    node[name] = call(channel)
  }
  return root
}
