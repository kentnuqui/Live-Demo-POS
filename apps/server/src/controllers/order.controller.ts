import type { Request } from 'express'
import { z } from 'zod'
import {
  addItemsSchema,
  canAccessBranch,
  discountSchema,
  mergeSchema,
  orderCreateSchema,
  orderPatchSchema,
  paymentSchema,
  progressSchema,
  refundSchema,
  splitSchema,
  transferSchema
} from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as actions from '../services/order-actions.service.js'
import * as orders from '../services/order.service.js'

async function guard(req: Request, orderId: string) {
  const order = await orders.getOrder(orderId)
  if (!req.user || !canAccessBranch(req.user.role, req.user.branchId, order.branchId)) {
    throw new AppError(403, 'Outside your branch')
  }
  return order
}

export const list = asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const type = typeof req.query.type === 'string' ? req.query.type : undefined
  ok(res, await orders.listOrders(req.params.branchId, status, type))
})

export const create = asyncHandler(async (req, res) => {
  ok(res, await orders.createOrder(req.user!, req.params.branchId, orderCreateSchema.parse(req.body)), 201)
})

export const show = asyncHandler(async (req, res) => {
  ok(res, await guard(req, req.params.orderId))
})

export const patch = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await orders.patchOrder(req.params.orderId, orderPatchSchema.parse(req.body)))
})

export const addItems = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await orders.addItems(req.params.orderId, addItemsSchema.parse(req.body)))
})

export const voidItem = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await orders.voidItem(req.params.orderId, req.params.itemId))
})

export const adjustItem = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  const body = z.object({ delta: z.number().int().min(-99).max(99) }).parse(req.body)
  ok(res, await orders.adjustItemQuantity(req.params.orderId, req.params.itemId, body.delta))
})

export const send = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await orders.sendOrder(req.params.orderId))
})

export const progress = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  const body = progressSchema.parse(req.body)
  if (body.status !== 'PREPARING' && body.status !== 'READY' && body.status !== 'SERVED') {
    throw new AppError(400, 'That step is not available')
  }
  ok(res, await orders.advanceOrder(req.params.orderId, body.status))
})

export const transfer = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  const body = transferSchema.parse(req.body)
  ok(res, await actions.transferOrder(req.user!, req.params.orderId, body.tableId))
})

export const merge = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  const body = mergeSchema.parse(req.body)
  ok(res, await actions.mergeOrders(req.params.orderId, body.sourceOrderId))
})

export const split = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await actions.splitOrder(req.user!, req.params.orderId, splitSchema.parse(req.body)))
})

export const bill = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await actions.billOrder(req.params.orderId))
})

export const discount = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await actions.applyDiscount(req.params.orderId, discountSchema.parse(req.body)))
})

export const pay = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await actions.payOrder(req.user!, req.params.orderId, paymentSchema.parse(req.body)))
})

export const refund = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await actions.refundOrder(req.user!, req.params.orderId, refundSchema.parse(req.body)))
})

export const finish = asyncHandler(async (req, res) => {
  await guard(req, req.params.orderId)
  ok(res, await actions.finishOrder(req.params.orderId))
})
