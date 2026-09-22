import { createServer } from 'node:http'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { prisma } from './lib/prisma.js'
import { attachSocket } from './socket.js'

const app = createApp()
const server = createServer(app)
attachSocket(server)

server.listen(env.PORT, () => {
  console.log(`Towns API listening on ${env.PORT}`)
})

async function shutdown() {
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
