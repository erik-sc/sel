// The `blocks` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'blocks:apply',
  'blocks:children',
  'blocks:create',
  'blocks:delete',
  'blocks:get',
  'blocks:getMany',
  'blocks:getTree',
  'blocks:move',
  'blocks:update'
]
