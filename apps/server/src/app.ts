import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { isAllowedOrigin, parseClientOrigins } from './config/origins.js'
import { errorHandler } from './middleware/error-handler.js'
import { api } from './routes/index.js'

export function createApp() {
  const allowed = parseClientOrigins(env.CLIENT_ORIGIN)
  const app = express()
  // APIs are called cross-origin from Netlify; default helmet CORP blocks that in browsers.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  )
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isAllowedOrigin(origin, allowed))
      }
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
