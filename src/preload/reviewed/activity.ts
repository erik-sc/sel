// The `activity` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = ['activity:clear', 'activity:open', 'activity:status', 'activity:summary']
