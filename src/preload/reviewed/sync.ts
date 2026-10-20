// The `sync` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'sync:disconnect',
  'sync:now',
  'sync:pause',
  'sync:pickGit',
  'sync:setEncryption',
  'sync:setup',
  'sync:status',
  'sync:unlock'
]
