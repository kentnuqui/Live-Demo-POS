import type { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { canAccessBranch } from '@towns/shared'
import { env } from './config/env.js'
import { isAllowedOrigin, parseClientOrigins } from './config/origins.js'
import { bindSocket } from './lib/events.js'
import { verifyAccessToken } from './lib/tokens.js'

/** Realtime fan-out. Terminals join the branch room after they present an access token. */
export function attachSocket(server: HttpServer): void {
  const allowed = parseClientOrigins(env.CLIENT_ORIGIN)
  const io = new Server(server, {
    cors: {
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin, allowed))
      }
    }
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
    if (typeof token !== 'string') {
      next(new Error('unauthorized'))
      return
    }
    try {
      socket.data.user = verifyAccessToken(token)
      next()
    } catch {
      next(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('branch:join', (branchId: unknown) => {
      if (typeof branchId !== 'string') return
      const user = socket.data.user as { role: Parameters<typeof canAccessBranch>[0]; branchId: string | null }
      if (!canAccessBranch(user.role, user.branchId, branchId)) return
      socket.join(`branch:${branchId}`)
    })
  })

  bindSocket(io)
}
