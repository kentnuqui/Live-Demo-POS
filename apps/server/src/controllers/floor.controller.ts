import { layoutSchema, tableSchema, tableStatusSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as floor from '../services/floor.service.js'

export const show = asyncHandler(async (req, res) => {
  ok(res, await floor.getFloor(req.params.branchId))
})

export const createTable = asyncHandler(async (req, res) => {
  const id = await floor.createTable(req.params.branchId, tableSchema.parse(req.body))
  ok(res, { id }, 201)
})

export const layout = asyncHandler(async (req, res) => {
  await floor.saveLayout(req.params.branchId, layoutSchema.parse(req.body))
  ok(res, { saved: true })
})

export const status = asyncHandler(async (req, res) => {
  const body = tableStatusSchema.parse(req.body)
  await floor.setTableStatus(req.params.branchId, req.params.tableId, body.status)
  ok(res, { saved: true })
})

export const removeTable = asyncHandler(async (req, res) => {
  await floor.deleteTable(req.params.branchId, req.params.tableId)
  ok(res, { deleted: true })
})
