// The `app` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'app:getSetting',
  'app:getTheme',
  'app:newWindow',
  'app:openExternal',
  'app:setSetting',
  'app:setTheme',
  'app:window.isMaximized'
]
