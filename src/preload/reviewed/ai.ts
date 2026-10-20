// The `ai` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
export const REVIEWED = ['ai:agents.connect', 'ai:agents.list', 'ai:agents.remove', 'ai:cancel', 'ai:pickCli', 'ai:run', 'ai:status']
