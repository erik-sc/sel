// The `versions` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'versions:clear',
  'versions:current',
  'versions:delete',
  'versions:get',
  'versions:list',
  'versions:rename',
  'versions:restore',
  'versions:save',
  'versions:stats'
]
