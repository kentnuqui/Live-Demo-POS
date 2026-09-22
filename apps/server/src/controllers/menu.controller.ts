import {
  categoryCreateSchema,
  categoryReorderSchema,
  categoryUpdateSchema,
  menuItemCreateSchema,
  menuItemReorderSchema,
  menuItemUpdateSchema,
  modifierGroupCreateSchema,
  modifierGroupUpdateSchema,
  modifierOptionCreateSchema,
  modifierOptionUpdateSchema,
  menuItemModifierAssignSchema
} from '@towns/shared'
import type { ZodType } from 'zod'
import { AppError } from '../lib/app-error.js'
import { asyncHandler } from '../lib/async-handler.js'
import { ok } from '../lib/response.js'
import * as menu from '../services/menu.service.js'

/** Turns the first validation issue into a message the cashier screen can show as-is. */
function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new AppError(400, issue?.message ?? 'Check the form and try again', result.error.issues)
  }
  return result.data
}

export const catalog = asyncHandler(async (req, res) => {
  ok(res, await menu.listMenu(req.params.branchId))
})

export const manage = asyncHandler(async (req, res) => {
  ok(res, await menu.listMenuManage(req.params.branchId))
})

export const createCategory = asyncHandler(async (req, res) => {
  ok(res, await menu.createCategory(req.params.branchId, parse(categoryCreateSchema, req.body)), 201)
})

export const updateCategory = asyncHandler(async (req, res) => {
  ok(res, await menu.updateCategory(req.params.branchId, req.params.categoryId, parse(categoryUpdateSchema, req.body)))
})

export const removeCategory = asyncHandler(async (req, res) => {
  ok(res, await menu.deleteCategory(req.params.branchId, req.params.categoryId))
})

export const reorderCategories = asyncHandler(async (req, res) => {
  const body = parse(categoryReorderSchema, req.body)
  ok(res, await menu.reorderCategories(req.params.branchId, body.ids))
})

export const createItem = asyncHandler(async (req, res) => {
  ok(res, await menu.createMenuItem(req.params.branchId, parse(menuItemCreateSchema, req.body)), 201)
})

export const updateItem = asyncHandler(async (req, res) => {
  ok(res, await menu.updateMenuItem(req.params.branchId, req.params.itemId, parse(menuItemUpdateSchema, req.body)))
})

export const removeItem = asyncHandler(async (req, res) => {
  ok(res, await menu.deleteMenuItem(req.params.branchId, req.params.itemId))
})

export const reorderItems = asyncHandler(async (req, res) => {
  const body = parse(menuItemReorderSchema, req.body)
  ok(res, await menu.reorderMenuItems(req.params.branchId, body.categoryId, body.ids))
})

// ============================================================================
// MODIFIER ENDPOINTS
// ============================================================================

export const listModifierGroups = asyncHandler(async (req, res) => {
  ok(res, await menu.listModifierGroups(req.params.branchId))
})

export const createModifierGroup = asyncHandler(async (req, res) => {
  ok(res, await menu.createModifierGroup(req.params.branchId, parse(modifierGroupCreateSchema, req.body)), 201)
})

export const updateModifierGroup = asyncHandler(async (req, res) => {
  ok(res, await menu.updateModifierGroup(req.params.branchId, req.params.groupId, parse(modifierGroupUpdateSchema, req.body)))
})

export const removeModifierGroup = asyncHandler(async (req, res) => {
  ok(res, await menu.deleteModifierGroup(req.params.branchId, req.params.groupId))
})

export const createModifierOption = asyncHandler(async (req, res) => {
  ok(res, await menu.createModifierOption(req.params.branchId, parse(modifierOptionCreateSchema, req.body)), 201)
})

export const updateModifierOption = asyncHandler(async (req, res) => {
  ok(res, await menu.updateModifierOption(req.params.branchId, req.params.optionId, parse(modifierOptionUpdateSchema, req.body)))
})

export const removeModifierOption = asyncHandler(async (req, res) => {
  ok(res, await menu.deleteModifierOption(req.params.branchId, req.params.optionId))
})

export const assignModifiers = asyncHandler(async (req, res) => {
  ok(res, await menu.assignModifierGroups(req.params.branchId, req.params.itemId, parse(menuItemModifierAssignSchema, req.body)))
})
