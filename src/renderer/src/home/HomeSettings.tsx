// Settings → General → Pages: which page or screen is the home (synced), and what sel does when
// it opens on this device. Pages can also be made the home from their menu.
import { useEffect, useState } from 'react'
import { HOME_SCREENS, STARTUP_MODES, type Home, type HomeScreen, type StartupMode } from '@shared/home'
import { acceleratorOf, formatAccelerator } from '@shared/shortcuts'
import type { Block } from '@shared/types'
import { fetchBlocks } from '@/store/blocks'
import { pageTitle } from '@/shell/actions'
import { isLinkedView } from '@/shell/linked'
import { IS_MAC } from '@/ui/platform'
import { setHome, setStartup, useHome, useHomeCopy, useHomeStatus } from './store'

const RECENT_PAGES = 20

/** The pages offered: favourites, then the top level, then recently edited ones. */
function useCandidatePages(): Block[] {
  const [pages, setPages] = useState<Block[]>([])
  useEffect(() => {
    let alive = true
    void Promise.all([
      fetchBlocks(() => window.api.pages.listFavorites()),
      fetchBlocks(() => window.api.pages.listRoot()),
      fetchBlocks(() => window.api.pages.listRecent(RECENT_PAGES))
    ])
      .then((lists) => {
        if (!alive) return
        const seen = new Set<string>()
        const out: Block[] = []
        for (const block of lists.flat()) {
          if (seen.has(block.id) || block.trashedAt || isLinkedView(block)) continue
          seen.add(block.id)
          out.push(block)
        }
        setPages(out)
      })
      .catch((error) => console.error('could not list the pages for the home', error))
    return () => {
      alive = false
    }
  }, [])
  return pages
}

function encode(home: Home): string {
  return home === null ? '' : home.kind === 'page' ? `page:${home.id}` : `screen:${home.route}`
}

function decode(value: string): Home {
  if (value.startsWith('page:')) return { kind: 'page', id: value.slice(5) }
  if (value.startsWith('screen:')) return { kind: 'screen', route: value.slice(7) as HomeScreen }
  return null
}

export function HomeSettingsRows() {
  const copy = useHomeCopy()
  const startup = useHome((state) => state.startup)
  const { home, status, block } = useHomeStatus()
  const pages = useCandidatePages()
  const homePageListed = home?.kind !== 'page' || pages.some((page) => page.id === home.id)
  const hint = status === 'trashed' ? copy.trashed : status === 'missing' ? copy.missing : null

  return (
    <>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.homeLabel}</span>
          <span className={hint ? 'ap-row-help is-error' : 'ap-row-help'}>{hint ?? copy.homeHelp(formatAccelerator(acceleratorOf('go-home', IS_MAC) ?? '', IS_MAC))}</span>
        </div>
        <div className="ap-row-control">
          <select className="ap-field" aria-label={copy.homeLabel} value={encode(home)} onChange={(event) => void setHome(decode(event.target.value))}>
            <option value="">{copy.none}</option>
            <optgroup label={copy.screensGroup}>
              {HOME_SCREENS.map((route) => (
                <option key={route} value={`screen:${route}`}>
                  {copy.screens[route]}
                </option>
              ))}
            </optgroup>
            <optgroup label={copy.pagesGroup}>
              {!homePageListed && home?.kind === 'page' && (
                <option value={`page:${home.id}`}>{block ? pageTitle(block) || copy.untitled : copy.missing}</option>
              )}
              {pages.map((page) => (
                <option key={page.id} value={`page:${page.id}`}>
                  {pageTitle(page) || copy.untitled}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>
      <div className="ap-row">
        <div className="ap-row-text">
          <span className="ap-row-label">{copy.startupLabel}</span>
          <span className="ap-row-help">{copy.startupHelp}</span>
        </div>
        <div className="ap-row-control">
          <select className="ap-field" aria-label={copy.startupLabel} value={startup} onChange={(event) => void setStartup(event.target.value as StartupMode)}>
            {STARTUP_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {copy.startup[mode]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  )
}
