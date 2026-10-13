/**
 * Stack of open floating layers (popovers, modals), oldest first. A layer only reacts
 * to Escape when it is the topmost one, and treats clicks inside layers opened after
 * it (its "children") as inside clicks.
 */
const layers: HTMLElement[] = []

export function pushLayer(el: HTMLElement): () => void {
  layers.push(el)
  return () => {
    const index = layers.indexOf(el)
    if (index >= 0) layers.splice(index, 1)
  }
}

export function isTopLayer(el: HTMLElement): boolean {
  return layers[layers.length - 1] === el
}

/** True when `target` is inside `el` or inside a layer stacked above it. */
export function isWithinLayer(el: HTMLElement, target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const from = layers.indexOf(el)
  if (from < 0) return el.contains(target)
  for (let i = from; i < layers.length; i++) {
    if (layers[i].contains(target)) return true
  }
  return false
}
