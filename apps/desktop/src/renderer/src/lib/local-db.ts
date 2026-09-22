import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface OutboxEntry {
  id: string
  kind: string
  branchId: string
  payload: unknown
  createdAt: string
  attempts: number
  lastError: string | null
}

interface BrowserSchema extends DBSchema {
  kv: { key: string; value: string }
  outbox: { key: string; value: OutboxEntry }
}

let browserDb: Promise<IDBPDatabase<BrowserSchema>> | null = null

function browser(): Promise<IDBPDatabase<BrowserSchema>> {
  browserDb ??= openDB<BrowserSchema>('towns-terminal', 1, {
    upgrade(db) {
      db.createObjectStore('kv')
      db.createObjectStore('outbox', { keyPath: 'id' })
    }
  })
  return browserDb
}

async function useSqlite(): Promise<boolean> {
  if (!window.towns) return false
  try {
    return await window.towns.local.ping()
  } catch {
    return false
  }
}

/** Key-value cache and offline outbox. Electron uses SQLite; the browser uses IndexedDB. */
export const localDb = {
  async kvGet(key: string): Promise<string | null> {
    if (await useSqlite()) return window.towns!.local.kvGet(key)
    return (await (await browser()).get('kv', key)) ?? null
  },
  async kvSet(key: string, value: string): Promise<void> {
    if (await useSqlite()) {
      await window.towns!.local.kvSet(key, value)
      return
    }
    await (await browser()).put('kv', value, key)
  },
  async outboxAdd(entry: Omit<OutboxEntry, 'attempts' | 'lastError'>): Promise<void> {
    if (await useSqlite()) {
      await window.towns!.local.outboxAdd(entry)
      return
    }
    await (await browser()).put('outbox', { ...entry, attempts: 0, lastError: null })
  },
  async outboxList(): Promise<OutboxEntry[]> {
    if (await useSqlite()) return window.towns!.local.outboxList()
    return (await browser()).getAll('outbox')
  },
  async outboxRemove(id: string): Promise<void> {
    if (await useSqlite()) {
      await window.towns!.local.outboxRemove(id)
      return
    }
    await (await browser()).delete('outbox', id)
  }
}
