import { localDb } from '@/lib/local-db'
import { isNetworkError } from '@/lib/api'

/** Reads through the network and keeps a copy for emergency mode. */
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const data = await load()
    await localDb.kvSet(key, JSON.stringify(data))
    return data
  } catch (error) {
    if (!isNetworkError(error)) throw error
    const raw = await localDb.kvGet(key)
    if (!raw) throw error
    return JSON.parse(raw) as T
  }
}

export async function queueOperation(kind: string, branchId: string, payload: unknown): Promise<void> {
  await localDb.outboxAdd({
    id: crypto.randomUUID(),
    kind,
    branchId,
    payload,
    createdAt: new Date().toISOString()
  })
}
