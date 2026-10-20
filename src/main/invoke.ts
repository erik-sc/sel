import type { IpcMainInvokeEvent } from 'electron'
import type { InvokeChannel } from '../shared/api'

/**
 * The handler of one invoke channel. Its arguments come from the renderer as they are, untrusted
 * (`unknown`), and are narrowed inside before use. It runs behind the wrapper in ./ipc.ts, which
 * checks the sender and the client id first and reduces any failure to a safe message.
 */
export type Handler = (args: unknown[], event: IpcMainInvokeEvent) => unknown

/**
 * A handler for every channel of `namespace` declared in `INVOKE` (src/shared/api.ts), and for
 * nothing else: a missing handler, or one for a channel that is not declared, fails typecheck.
 * Without a namespace: every declared channel, which ./ipc.ts and the features of ./features.ts answer together.
 */
export type Handlers<Namespace extends string = string> = {
  [C in InvokeChannel as C extends `${Namespace}:${string}` ? C : never]: Handler
}
