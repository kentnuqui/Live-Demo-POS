import { qrOrderSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as qr from '../services/qr.service.js'

export const show = asyncHandler(async (req, res) => {
  ok(res, await qr.getQrContext(req.params.token))
})

export const order = asyncHandler(async (req, res) => {
  ok(res, await qr.placeQrOrder(req.params.token, qrOrderSchema.parse(req.body)), 201)
})
