// The `notebook` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = ['notebook:dismissPlans', 'notebook:get', 'notebook:plan', 'notebook:review', 'notebook:write']
