import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { parseClientOrigins } from './config/origins.js'
import { errorHandler } from './middleware/error-handler.js'
import { api } from './routes/index.js'

export function createApp() {
  const origins = parseClientOrigins(env.CLIENT_ORIGIN)
  const app = express()
  app.use(helmet())
  app.use(
    cors({
      origin: origins
    })
  )
  app.use(express.json({ limit: '1mb' }))
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'success', data: { ok: true } })
  })
  app.use('/api', api)
  app.use(errorHandler)
  return app
}
