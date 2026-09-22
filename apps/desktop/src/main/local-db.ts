import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const { app } = createRequire(import.meta.url)('electron') as typeof import('electron')
import { join } from 'node:path'

interface SqlStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): unknown
}

interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
}

let database: SqlDatabase | null = null

/**
 * Terminal cache. Uses Node's built-in SQLite when Electron ships it,
 * which keeps the offline queue off the renderer thread.
 */
export async function openLocalDb(): Promise<boolean> {
  if (database) return true
  try {
    const sqlite = (await import('node:sqlite')) as { DatabaseSync: new (path: string) => SqlDatabase }
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    const db = new sqlite.DatabaseSync(join(dir, 'towns-terminal.sqlite'))
    db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
    `)
    database = db
    return true
  } catch (error) {
    console.error('SQLite cache unavailable', error)
    return false
  }
}

export function kvGet(key: string): string | null {
  const row = database?.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function kvSet(key: string, value: string): void {
  database?.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function outboxAdd(entry: { id: string; kind: string; branchId: string; payload: unknown; createdAt: string }): void {
  database
    ?.prepare('INSERT OR REPLACE INTO outbox (id, kind, branch_id, payload, created_at, attempts, last_error) VALUES (?, ?, ?, ?, ?, 0, NULL)')
    .run(entry.id, entry.kind, entry.branchId, JSON.stringify(entry.payload), entry.createdAt)
}

export function outboxList(): Array<{ id: string; kind: string; branchId: string; payload: unknown; createdAt: string; attempts: number; lastError: string | null }> {
  const rows = (database?.prepare('SELECT * FROM outbox ORDER BY created_at ASC').all() ?? []) as Array<{
    id: string
    kind: string
    branch_id: string
    payload: string
    created_at: string
    attempts: number
    last_error: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    branchId: row.branch_id,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at,
    attempts: row.attempts,
    lastError: row.last_error
  }))
}

export function outboxRemove(id: string): void {
  database?.prepare('DELETE FROM outbox WHERE id = ?').run(id)
}

export function outboxFail(id: string, message: string): void {
  database?.prepare('UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(message, id)
}
