// The `ai` invoke channels a renderer can reach, written out to be reviewed: a change here
// changes what the bridge exposes. index.test.ts checks this list against INVOKE.
// `ai:servers`, `ai:scanServers` and `ai:serverTools` list the MCP servers of the user's own
// Claude Code by name (never their definitions) and look up their tools.
export const REVIEWED = ['ai:cancel', 'ai:pickCli', 'ai:run', 'ai:scanServers', 'ai:serverTools', 'ai:servers', 'ai:status']
