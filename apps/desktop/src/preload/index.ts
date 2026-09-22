import { createRequire } from 'node:module'

const { contextBridge, ipcRenderer } = createRequire(import.meta.url)('electron') as typeof import('electron')

const towns = {
  local: {
    ping: (): Promise<boolean> => ipcRenderer.invoke('local:ping'),
    kvGet: (key: string): Promise<string | null> => ipcRenderer.invoke('local:kv-get', key),
    kvSet: (key: string, value: string): Promise<void> => ipcRenderer.invoke('local:kv-set', key, value),
    outboxAdd: (entry: { id: string; kind: string; branchId: string; payload: unknown; createdAt: string }): Promise<void> =>
      ipcRenderer.invoke('local:outbox-add', entry),
    outboxList: (): Promise<Array<{ id: string; kind: string; branchId: string; payload: unknown; createdAt: string; attempts: number; lastError: string | null }>> =>
      ipcRenderer.invoke('local:outbox-list'),
    outboxRemove: (id: string): Promise<void> => ipcRenderer.invoke('local:outbox-remove', id),
    outboxFail: (id: string, message: string): Promise<void> => ipcRenderer.invoke('local:outbox-fail', id, message)
  },
  hardware: {
    print: (address: string, lines: string[]): Promise<{ ok: boolean; message: string }> =>
      ipcRenderer.invoke('hardware:print', address, lines),
    drawer: (address: string): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('hardware:drawer', address)
  }
}

contextBridge.exposeInMainWorld('towns', towns)

export type TownsBridge = typeof towns
