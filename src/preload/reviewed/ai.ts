// The `ai` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
// `ai:servers`, `ai:scanServers` and `ai:serverTools` list the MCP servers of the user's own
// Claude Code by name (never their definitions) and look up their tools. `ai:remember` and
// `ai:memory` are the persona's memory (0.8.0 A3): main picks the facts and keeps them.
export const REVIEWED = [
  'ai:cancel',
  'ai:memory',
  'ai:pickCli',
  'ai:remember',
  'ai:run',
  'ai:scanServers',
  'ai:serverTools',
  'ai:servers',
  'ai:status'
]
