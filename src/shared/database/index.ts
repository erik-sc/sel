// Pure database logic: no React, no store, no DOM, no Electron. Everything here is unit-tested.
// Split by responsibility. The renderer imports it through database/logic.ts; main (Markdown,
// the AI's writes) imports the modules it needs.
export * from '@shared/database/dates'
export * from '@shared/database/values'
export * from '@shared/database/query'
export * from '@shared/database/views'
export * from '@shared/database/normalize'
export * from '@shared/database/mutations'
export * from '@shared/database/resolve'
export * from '@shared/database/relation'
export * from '@shared/database/rollup'
export * from '@shared/database/cell'
export * from '@shared/database/bulk'
export * from '@shared/database/formula'
// Chart views: only their configuration. The aggregation engine (./chart.ts) and the
// chart geometry (./chartScale.ts) are loaded with the chart view (views/chartLogic.ts).
export * from '@shared/database/chartConfig'
// Calculations views: only the stored shape of their figures. The formula engine
// (./calc.ts) is loaded with the view (views/CalcView.tsx).
export * from '@shared/database/calcConfig'
