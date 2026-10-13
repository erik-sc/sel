/**
 * The minimal synchronous SQLite surface the repository depends on.
 * Both `better-sqlite3` (production, Electron ABI) and Node's built-in
 * `node:sqlite` DatabaseSync (tests) satisfy it structurally.
 */
export interface SqlStatement {
  run(...params: any[]): unknown
  get(...params: any[]): unknown
  all(...params: any[]): unknown[]
}

export interface SqlDriver {
  exec(sql: string): unknown
  prepare(sql: string): SqlStatement
  close(): unknown
}
