// Test support for components in a DOM (happy-dom): render with React, ask axe what it finds, and
// a stand-in for window.api. A test file that uses it starts with `// @vitest-environment happy-dom`.
import axe from 'axe-core'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

declare global {
  // React's flag for tests: updates are wrapped in act() and flushed before it returns.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

/** Renders `node` into a fresh container in the body; everything rendered is removed by `cleanup`. */
export async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(node))
  return container
}

export async function cleanup(): Promise<void> {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
}

/** Lets lazy components, effects and promises settle. */
export async function settle(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

export async function press(target: Element, key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

/**
 * What axe finds that is serious or critical. Colour contrast is left to contrast.test.ts (happy-dom
 * lays nothing out), and landmarks to the whole app (a component is not a page).
 */
export async function seriousViolations(root: Element = document.body): Promise<string[]> {
  const result = await axe.run(root, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } }
  })
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
}

/**
 * A window.api where every call resolves to `undefined` (or to what `answers` gives for its
 * path, such as 'pages.listRecent'), and every `on*` returns an unsubscribe function.
 */
export function fakeApi(answers: Record<string, unknown> = {}): unknown {
  const at = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, prop) => {
        if (typeof prop === 'symbol') return undefined
        // Not a promise: `await window.api` and `window.api.x` must not look thenable.
        if (prop === 'then') return undefined
        return at([...path, prop])
      },
      apply: () => {
        const name = path.join('.')
        const last = path[path.length - 1] ?? ''
        if (/^on[A-Z]/.test(last)) return () => undefined
        return Promise.resolve(name in answers ? answers[name] : undefined)
      }
    })
  return at([])
}
