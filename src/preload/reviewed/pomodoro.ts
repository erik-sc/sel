// The `pomodoro` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = [
  'pomodoro:next',
  'pomodoro:pause',
  'pomodoro:resume',
  'pomodoro:skip',
  'pomodoro:start',
  'pomodoro:state',
  'pomodoro:stop'
]
