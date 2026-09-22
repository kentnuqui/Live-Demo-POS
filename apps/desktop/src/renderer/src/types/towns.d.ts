interface OutboxEntry {
  id: string
  kind: string
  branchId: string
  payload: unknown
  createdAt: string
  attempts: number
  lastError: string | null
}

interface TownsBridge {
  local: {
    ping: () => Promise<boolean>
    kvGet: (key: string) => Promise<string | null>
    kvSet: (key: string, value: string) => Promise<void>
    outboxAdd: (entry: { id: string; kind: string; branchId: string; payload: unknown; createdAt: string }) => Promise<void>
    outboxList: () => Promise<OutboxEntry[]>
    outboxRemove: (id: string) => Promise<void>
    outboxFail: (id: string, message: string) => Promise<void>
  }
  hardware: {
    print: (address: string, lines: string[]) => Promise<{ ok: boolean; message: string }>
    drawer: (address: string) => Promise<{ ok: boolean; message: string }>
  }
}

declare global {
  interface Window {
    towns?: TownsBridge
  }
}

export {}
