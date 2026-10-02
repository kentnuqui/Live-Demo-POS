import { kitchenAdvanceSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as kitchen from '../services/kitchen.service.js'

export const board = asyncHandler(async (req, res) => {
  ok(res, await kitchen.listKitchen(req.params.branchId))
})

export const advance = asyncHandler(async (req, res) => {
  const body = kitchenAdvanceSchema.parse(req.body)
  ok(res, await kitchen.advanceKitchen(req.params.branchId, req.params.orderId, body.status))
})
