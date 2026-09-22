import type { Server } from 'socket.io'

let io: Server | null = null

export function bindSocket(server: Server): void {
  io = server
}

/** Fan-out after a transaction has committed. Listeners on other terminals refetch. */
export function emitBranch(branchId: string, event: string, data: unknown): void {
  io?.to(`branch:${branchId}`).emit(event, data)
}
