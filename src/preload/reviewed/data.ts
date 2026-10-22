// The `data` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = ['data:backUp', 'data:exportMarkdown', 'data:openLogs', 'data:restore', 'data:showBackups', 'data:status']
