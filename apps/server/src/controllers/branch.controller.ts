import { branchSchema, branchSettingsSchema, printerSchema, profileSchema, receiptSchema } from '@towns/shared'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as branches from '../services/branch.service.js'
import * as settings from '../services/settings.service.js'

export const list = asyncHandler(async (req, res) => {
  ok(res, await branches.listBranches(req.user!))
})

export const create = asyncHandler(async (req, res) => {
  ok(res, await branches.createBranch(branchSchema.parse(req.body)), 201)
})

export const update = asyncHandler(async (req, res) => {
  ok(res, await branches.updateBranch(req.params.branchId, branchSchema.parse(req.body)))
})

export const profile = asyncHandler(async (_req, res) => {
  ok(res, await settings.getProfile())
})

export const saveProfile = asyncHandler(async (req, res) => {
  ok(res, await settings.updateProfile(profileSchema.parse(req.body)))
})

export const branchSettings = asyncHandler(async (req, res) => {
  ok(res, await settings.getSettings(req.params.branchId))
})

export const saveBranchSettings = asyncHandler(async (req, res) => {
  ok(res, await settings.updateSettings(req.params.branchId, branchSettingsSchema.parse(req.body)))
})

export const saveReceipt = asyncHandler(async (req, res) => {
  ok(res, await settings.updateReceipt(req.params.branchId, receiptSchema.parse(req.body)))
})

export const printers = asyncHandler(async (req, res) => {
  ok(res, await settings.listPrinters(req.params.branchId))
})

export const createPrinter = asyncHandler(async (req, res) => {
  ok(res, await settings.createPrinter(req.params.branchId, printerSchema.parse(req.body)), 201)
})

export const updatePrinter = asyncHandler(async (req, res) => {
  ok(res, await settings.updatePrinter(req.params.branchId, req.params.printerId, printerSchema.parse(req.body)))
})

export const deletePrinter = asyncHandler(async (req, res) => {
  await settings.deletePrinter(req.params.branchId, req.params.printerId)
  ok(res, { deleted: true })
})
