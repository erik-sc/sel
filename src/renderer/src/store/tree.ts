import { create } from 'zustand'
import { systemKindOf } from '../../../shared/system'
import { notifyError } from '../ui/toast'
import { addCacheRoots, fetchBlocks, getBlock } from './blocks'

/** Key under which the workspace-root pages are stored in `children`. */
export const ROOT = '__root__'

interface TreeState {
  /** Sidebar tree: page id (or ROOT) -> ordered ids of its non-trashed child pages. */
  children: Record<string, string[]>
  favorites: string[]
  loaded: boolean
}

export const useTree = create<TreeState>(() => ({ children: {}, favorites: [], loaded: false }))

// Everything the sidebar lists (and the pages it lists them under) stays in the block cache.
addCacheRoots(() => {
  const { children, favorites } = useTree.getState()
  const ids = new Set<string>(favorites)
  for (const [key, list] of Object.entries(children)) {
    if (key !== ROOT) ids.add(key)
    for (const id of list) ids.add(id)
  }
  return { ids }
})

function sameIds(a: string[] | undefined, b: string[]): boolean {
  return !!a && a.length === b.length && a.every((id, i) => id === b[i])
}

async function fetchChildren(key: string): Promise<string[]> {
  const blocks = await fetchBlocks(() => (key === ROOT ? window.api.pages.listRoot() : window.api.pages.listChildren(key)))
  // The notebook lives at the root but has a place of its own in the sidebar, above the tree.
  return blocks.filter((b) => key !== ROOT || systemKindOf(b) !== 'notebook').map((b) => b.id)
}

export async function loadTreeChildren(key: string): Promise<void> {
  const ids = await fetchChildren(key)
  useTree.setState((state) =>
    sameIds(state.children[key], ids) ? state : { children: { ...state.children, [key]: ids } }
  )
}

let running: Promise<void> | null = null
let again = false

/** Reloads the root list, the favourites and every page whose children were loaded. */
export function refreshTree(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      try {
        const keys = [ROOT, ...Object.keys(useTree.getState().children).filter((k) => k !== ROOT)]
        const [favorites, ...lists] = await Promise.all([
          fetchBlocks(() => window.api.pages.listFavorites()).then((blocks) => blocks.map((b) => b.id)),
          // A list that fails to load keeps what it showed; it must not look empty.
          ...keys.map((key) => fetchChildren(key).catch(() => null))
        ])
        useTree.setState((state) => {
          // Start from the current lists: one loaded while this refresh ran is newer than it.
          const children: Record<string, string[]> = { ...state.children }
          let changed = false
          keys.forEach((key, i) => {
            const list = lists[i]
            // Forget pages that were deleted for good.
            if (key !== ROOT && !getBlock(key)) {
              if (key in children) changed = true
              delete children[key]
            } else if (list && !sameIds(children[key], list)) {
              children[key] = list
              changed = true
            }
          })
          const favChanged = !sameIds(state.favorites, favorites)
          if (!changed && !favChanged && state.loaded) return state
          return {
            children: changed ? children : state.children,
            favorites: favChanged ? favorites : state.favorites,
            loaded: true
          }
        })
      } catch (error) {
        notifyError('The page list could not be loaded.', error)
      }
    } while (again)
    running = null
  })()
  return running
}

/** Change events arrive in bursts while typing; one refresh per burst is enough. */
const REFRESH_DELAY = 200
let timer: ReturnType<typeof setTimeout> | undefined
let subscribed = false

let initPromise: Promise<void> | null = null

/** Loads the tree and keeps it fresh on every data change. Safe to call more than once. */
export function initTree(): Promise<void> {
  if (!subscribed) {
    subscribed = true
    window.api.onChange((event) => {
      // Own edits to ordinary blocks (typing in a page) cannot change the tree.
      if (event.origin === window.api.clientId) {
        const relevant = event.ids.some((id) => {
          const block = getBlock(id)
          return !block || block.type === 'page' || block.type === 'database'
        })
        if (!relevant) return
      }
      clearTimeout(timer)
      timer = setTimeout(() => void refreshTree(), REFRESH_DELAY)
    })
  }
  initPromise ??= refreshTree()
  return initPromise
}
