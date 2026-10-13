// Chart views created in this window that nobody configured yet. Such a view shows a
// row of chart types above the plot, so that the first choice is one click; the row
// goes away with that choice (or when the settings panel is used instead).
// Session state only: it is never stored, and another window simply does not show the row.
const fresh = new Set<string>()

export function markFreshChart(viewId: string): void {
  fresh.add(viewId)
}

export function isFreshChart(viewId: string): boolean {
  return fresh.has(viewId)
}

export function settleChart(viewId: string): void {
  fresh.delete(viewId)
}
