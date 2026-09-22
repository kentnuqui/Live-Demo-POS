import { syncPushSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as sync from '../services/sync.service.js'

export const push = asyncHandler(async (req, res) => {
  ok(res, await sync.pushSync(req.user!, syncPushSchema.parse(req.body)))
})

export const pull = asyncHandler(async (req, res) => {
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : ''
  const lastSyncTimestamp = typeof req.query.lastSyncTimestamp === 'string' ? req.query.lastSyncTimestamp : undefined
  ok(res, await sync.pullSync(req.user!, branchId, lastSyncTimestamp))
})
