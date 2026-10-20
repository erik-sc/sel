// A component fetched the first time it is shown, like React's `lazy`, that can also be fetched
// ahead (`preload`) and, once fetched, renders at once instead of suspending for a frame.
import { createElement, lazy, type ComponentType, type JSX } from 'react'

export interface LazyPanel {
  (): JSX.Element
  /** Starts fetching it; resolves when it can be shown without waiting (a failure is left to the render). */
  preload(): Promise<void>
}

export function lazyPanel(load: () => Promise<ComponentType>): LazyPanel {
  let loaded: ComponentType | null = null
  let loading: Promise<ComponentType> | null = null
  const fetch = (): Promise<ComponentType> =>
    (loading ??= load().then((component) => {
      loaded = component
      return component
    }))
  const Lazy = lazy(() => fetch().then((component) => ({ default: component })))
  const Panel = (): JSX.Element => createElement(loaded ?? Lazy)
  return Object.assign(Panel, {
    preload: () =>
      fetch().then(
        () => undefined,
        () => undefined
      )
  })
}
