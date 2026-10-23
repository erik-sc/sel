// The `data` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'data:backUp',
  'data:compare',
  'data:exportMarkdown',
  'data:openLogs',
  'data:pickFile',
  'data:restoreAll',
  'data:restorePage',
  'data:showBackups',
  'data:status'
]
