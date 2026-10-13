// Parts of the database feature that most sessions never open: the non-default views, the
// filter / sort / properties panels, the linked-view pickers and the date picker. Each loads on demand and is
// preloaded when the pointer or the focus reaches its trigger.
import { lazy } from 'react'
import type { JSX } from 'react'
import type { ViewType } from '@shared/types'
import { SkeletonLines } from '@/ui/Skeleton'

const loadPanels = (): Promise<typeof import('./panels')> => import('./panels')
const loadDatePicker = (): Promise<typeof import('./DatePicker')> => import('./DatePicker')
const loadLinkedPanels = (): Promise<typeof import('./linkedPanels')> => import('./linkedPanels')
const loadBoard = (): Promise<typeof import('./views/BoardView')> => import('./views/BoardView')
const loadGallery = (): Promise<typeof import('./views/GalleryView')> => import('./views/GalleryView')
const loadCalendar = (): Promise<typeof import('./views/CalendarView')> => import('./views/CalendarView')
const loadChart = (): Promise<typeof import('./views/ChartView')> => import('./views/ChartView')
const loadChartPanel = (): Promise<typeof import('./views/ChartPanel')> => import('./views/ChartPanel')

export const FilterPanel = lazy(() => loadPanels().then((module) => ({ default: module.FilterPanel })))
export const SortPanel = lazy(() => loadPanels().then((module) => ({ default: module.SortPanel })))
export const PropertiesPanel = lazy(() => loadPanels().then((module) => ({ default: module.PropertiesPanel })))
export const LocationsPanel = lazy(() => loadLinkedPanels().then((module) => ({ default: module.LocationsPanel })))
export const PagePicker = lazy(() => loadLinkedPanels().then((module) => ({ default: module.PagePicker })))
export const DatePicker = lazy(() => loadDatePicker().then((module) => ({ default: module.DatePicker })))
export const BoardView = lazy(() => loadBoard().then((module) => ({ default: module.BoardView })))
export const GalleryView = lazy(() => loadGallery().then((module) => ({ default: module.GalleryView })))
export const CalendarView = lazy(() => loadCalendar().then((module) => ({ default: module.CalendarView })))
export const ChartView = lazy(() => loadChart().then((module) => ({ default: module.ChartView })))
export const ChartPanel = lazy(() => loadChartPanel().then((module) => ({ default: module.ChartPanel })))

function quiet(load: () => Promise<unknown>): void {
  load().catch(() => undefined)
}

export function preloadPanels(): void {
  quiet(loadPanels)
}

export function preloadChartPanel(): void {
  quiet(loadChartPanel)
}

export function preloadLinkedPanels(): void {
  quiet(loadLinkedPanels)
}

export function preloadDatePicker(): void {
  quiet(loadDatePicker)
}

/** Table and list views ship with the database itself; the others are fetched here. */
export function preloadView(type: ViewType): void {
  if (type === 'board') quiet(loadBoard)
  else if (type === 'gallery') quiet(loadGallery)
  else if (type === 'calendar') quiet(loadCalendar)
  else if (type === 'chart') quiet(loadChart)
}

/** Holds the place of a view, panel or picker while its code loads. */
export function PartFallback({ kind }: { kind: 'view' | 'popover' }): JSX.Element {
  return (
    <div className={kind === 'view' ? 'db-part-loading is-view' : 'db-part-loading'} aria-busy="true">
      <SkeletonLines />
    </div>
  )
}
