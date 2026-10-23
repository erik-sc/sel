// The routes of the built-in screens: what a tab holds instead of a page id when it shows one. No
// block can have one (block ids are uuids). A leaf: it imports nothing, so the tabs store
// (store/tabs.ts) and every feature can use it. A screen adds its route here, one line; its
// descriptor goes in ./screens.ts.

/** The Today screen (see briefing/route.ts). */
export const TODAY_ROUTE = '_today'
/** The calendar screen, likewise. */
export const CALENDAR_ROUTE = '_calendar'
/** The Tasks screen (tasks/gate.ts). */
export const TASKS_ROUTE = '_tasks'
/** The ink notebook (see notebook/route.ts). */
export const NOTEBOOK_ROUTE = '_notebook'
/** The ritual that closes the day, likewise. */
export const CLOSE_ROUTE = '_close'
/** The weekly review (see review/route.ts). */
export const REVIEW_ROUTE = '_week'
/** The Sky (see sky/route.ts). */
export const SKY_ROUTE = '_sky'
/** The heatmaps and flows of the activity log (see flows/route.ts). */
export const FLOWS_ROUTE = '_flows'
