import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
  MenuCategoryDto,
  MenuItemCreateInput,
  MenuItemUpdateInput,
  ModifierGroupDto,
  ModifierGroupCreateInput,
  ModifierGroupUpdateInput,
  ModifierOptionCreateInput,
  ModifierOptionUpdateInput,
  MenuItemModifierAssignInput
} from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { context, publish } from '../lib/context.js'
import { toMenuDto } from '../lib/mappers.js'
import { prisma } from '../lib/prisma.js'

const itemOrder = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }]
const categoryOrder = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }]

/**
 * Active categories and available dishes for the cashier and the QR menu.
 * Inactive rows stay in the database so open and past checks keep their item names.
 */
export async function listMenu(branchId: string): Promise<MenuCategoryDto[]> {
  const categories = await prisma.menuCategory.findMany({
    where: { branchId, isActive: true },
    include: {
      items: {
        where: { isAvailable: true },
        include: {
          modifierGroups: {
            where: {
              modifierGroup: { isActive: true }
            },
            include: {
              modifierGroup: {
                include: {
                  options: {
                    where: { isActive: true },
                    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
                  }
                }
              }
            }
          }
        },
        orderBy: itemOrder
      }
    },
    orderBy: categoryOrder
  })
  return toMenuDto(categories)
}

/** Full catalog, including hidden categories and dishes, for menu management. */
export async function listMenuManage(branchId: string): Promise<MenuCategoryDto[]> {
  const categories = await prisma.menuCategory.findMany({
    where: { branchId },
    include: { 
      items: { 
        include: {
          modifierGroups: {
            include: {
              modifierGroup: {
                include: {
                  options: {
                    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
                  }
                }
              }
            }
          }
        },
        orderBy: itemOrder 
      } 
    },
    orderBy: categoryOrder
  })
  return toMenuDto(categories)
}

/** Creates a category at the end of the cashier list unless a position is given. */
export async function createCategory(branchId: string, input: CategoryCreateInput): Promise<MenuCategoryDto[]> {
  const name = input.name.trim()
  if (!name) throw new AppError(400, 'Category name is required')
  await assertCategoryName(branchId, name)
  let createdId = ''
  try {
    const created = await prisma.menuCategory.create({
      data: {
        branchId,
        name,
        description: input.description?.trim() ?? '',
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0
      }
    })
    createdId = created.id
  } catch (error) {
    throw mappedWriteError(error, `A category named "${name}" already exists. Use a different name.`)
  }
  await placeCategory(branchId, createdId, input.sortOrder ?? Number.MAX_SAFE_INTEGER)
  publishMenu(branchId)
  return listMenuManage(branchId)
}

/** Renames, describes, shows, or hides a category without moving its dishes. */
export async function updateCategory(
  branchId: string,
  categoryId: string,
  input: CategoryUpdateInput
): Promise<MenuCategoryDto[]> {
  await requireCategory(branchId, categoryId)
  const name = input.name?.trim()
  if (input.name !== undefined && !name) throw new AppError(400, 'Category name is required')
  if (name) await assertCategoryName(branchId, name, categoryId)
  try {
    await prisma.menuCategory.update({
      where: { id: categoryId },
      data: {
        ...(name ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    })
  } catch (error) {
    throw mappedWriteError(error, `A category named "${name ?? 'that'}" already exists. Use a different name.`)
  }
  if (input.sortOrder !== undefined) await placeCategory(branchId, categoryId, input.sortOrder)
  publishMenu(branchId)
  return listMenuManage(branchId)
}

/**
 * Deletes an empty category.
 * Dishes must be moved first so this cannot remove menu items or ticket history.
 */
export async function deleteCategory(branchId: string, categoryId: string): Promise<MenuCategoryDto[]> {
  const category = await requireCategory(branchId, categoryId)
  const itemCount = await prisma.menuItem.count({ where: { categoryId } })
  if (itemCount > 0) {
    const noun = itemCount === 1 ? 'menu item' : 'menu items'
    throw new AppError(
      409,
      `"${category.name}" still has ${itemCount} ${noun}. Move them to another category before deleting it.`
    )
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.tombstone.create({
        data: { id: randomUUID(), branchId, entity: 'menuCategory', entityId: categoryId }
      })
      await tx.menuCategory.delete({ where: { id: categoryId } })
    })
  } catch (error) {
    throw mappedWriteError(error, `A category named "${category.name}" already exists. Use a different name.`)
  }
  await compactCategories(branchId)
  publishMenu(branchId)
  return listMenuManage(branchId)
}

/** Rewrites category positions from the given order. Every category on the branch must be included once. */
export async function reorderCategories(branchId: string, ids: string[]): Promise<MenuCategoryDto[]> {
  await assertFullSet(
    ids,
    await prisma.menuCategory.findMany({ where: { branchId }, select: { id: true } }),
    'category'
  )
  await prisma.$transaction(
    ids.map((id, index) => prisma.menuCategory.update({ where: { id }, data: { sortOrder: index } }))
  )
  publishMenu(branchId)
  return listMenuManage(branchId)
}

/** Adds a dish to an existing category. The dish is one row, not a copy per category. */
export async function createMenuItem(branchId: string, input: MenuItemCreateInput): Promise<MenuCategoryDto[]> {
  await requireCategory(branchId, input.categoryId)
  const name = input.name.trim()
  if (!name) throw new AppError(400, 'Item name is required')
  await assertItemName(input.categoryId, name)
  let createdId = ''
  try {
    const created = await prisma.menuItem.create({
      data: {
        categoryId: input.categoryId,
        name,
        description: input.description?.trim() ?? '',
        priceCents: input.priceCents,
        station: input.station,
        isAvailable: input.isAvailable ?? true,
        sortOrder: input.sortOrder ?? 0
      }
    })
    createdId = created.id
  } catch (error) {
    throw mappedWriteError(error, `"${name}" is already in this category. Edit the existing item instead.`)
  }
  await placeItem(input.categoryId, createdId, input.sortOrder ?? Number.MAX_SAFE_INTEGER)
  publishMenu(branchId)
  return listMenuManage(branchId)
}

/** Edits a dish, including moving it to another category on the same branch. */
export async function updateMenuItem(
  branchId: string,
  itemId: string,
  input: MenuItemUpdateInput
): Promise<MenuCategoryDto[]> {
  const item = await requireItem(branchId, itemId)
  const categoryId = input.categoryId ?? item.categoryId
  if (input.categoryId && input.categoryId !== item.categoryId) {
    await requireCategory(branchId, input.categoryId)
  }
  const trimmedName = input.name?.trim()
  if (input.name !== undefined && !trimmedName) throw new AppError(400, 'Item name is required')
  const name = trimmedName ?? item.name
  if (name !== item.name || categoryId !== item.categoryId) {
    await assertItemName(categoryId, name, itemId)
  }
  try {
    await prisma.menuItem.update({
      where: { id: itemId },
      data: {
        categoryId,
        name,
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.station !== undefined ? { station: input.station } : {}),
        ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {})
      }
    })
  } catch (error) {
    throw mappedWriteError(error, `"${name}" is already in that category. Use a different name.`)
  }
  const moved = categoryId !== item.categoryId
  if (input.sortOrder !== undefined || moved) {
    await placeItem(categoryId, itemId, input.sortOrder ?? Number.MAX_SAFE_INTEGER)
  }
  if (moved) await compactItems(item.categoryId)
  publishMenu(branchId)
  return listMenuManage(branchId)
}

/**
 * Deletes a dish that has never been sold.
 * Sold dishes stay in place so ticket lines, receipts, and reports keep their snapshot.
 */
export async function deleteMenuItem(branchId: string, itemId: string): Promise<MenuCategoryDto[]> {
  const item = await requireItem(branchId, itemId)
  const sold = await prisma.orderItem.count({ where: { menuItemId: itemId } })
  if (sold > 0) {
    const noun = sold === 1 ? 'ticket line' : 'ticket lines'
    throw new AppError(
      409,
      `"${item.name}" is on ${sold} ${noun}. Deactivate it instead of deleting it so past sales stay intact.`
    )
  }
  await prisma.$transaction(async (tx) => {
    await tx.tombstone.create({
      data: { id: randomUUID(), branchId, entity: 'menuItem', entityId: itemId }
    })
    await tx.menuItem.delete({ where: { id: itemId } })
  })
  await compactItems(item.categoryId)
  publishMenu(branchId)
  return listMenuManage(branchId)
}

/** Rewrites dish positions inside one category. Every dish in that category must be included once. */
export async function reorderMenuItems(branchId: string, categoryId: string, ids: string[]): Promise<MenuCategoryDto[]> {
  await requireCategory(branchId, categoryId)
  await assertFullSet(
    ids,
    await prisma.menuItem.findMany({ where: { categoryId }, select: { id: true } }),
    'menu item'
  )
  await prisma.$transaction(
    ids.map((id, index) => prisma.menuItem.update({ where: { id }, data: { sortOrder: index } }))
  )
  publishMenu(branchId)
  return listMenuManage(branchId)
}

function publishMenu(branchId: string): void {
  publish(context(), branchId, 'menu.updated', {})
}

async function requireCategory(branchId: string, categoryId: string) {
  const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, branchId } })
  if (!category) throw new AppError(404, 'That category is not on this branch')
  return category
}

async function requireItem(branchId: string, itemId: string) {
  const item = await prisma.menuItem.findFirst({
    where: { id: itemId, category: { branchId } }
  })
  if (!item) throw new AppError(404, 'That menu item is not on this branch')
  return item
}

async function assertCategoryName(branchId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.menuCategory.findFirst({
    where: {
      branchId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      name: { equals: name, mode: 'insensitive' }
    },
    select: { name: true }
  })
  if (clash) {
    throw new AppError(409, `A category named "${clash.name}" already exists. Use a different name.`)
  }
}

async function assertItemName(categoryId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.menuItem.findFirst({
    where: {
      categoryId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      name: { equals: name, mode: 'insensitive' }
    },
    select: { name: true }
  })
  if (clash) {
    throw new AppError(409, `"${clash.name}" is already in this category. Edit the existing item instead.`)
  }
}

/** Closes gaps after a category is removed so display order stays contiguous. */
async function compactCategories(branchId: string): Promise<void> {
  const rows = await prisma.menuCategory.findMany({
    where: { branchId },
    orderBy: categoryOrder,
    select: { id: true }
  })
  if (rows.length === 0) return
  await prisma.$transaction(
    rows.map((row, position) => prisma.menuCategory.update({ where: { id: row.id }, data: { sortOrder: position } }))
  )
}

/** Inserts a category at a 0-based position and rewrites every position so the cashier order cannot tie. */
async function placeCategory(branchId: string, categoryId: string, index: number): Promise<void> {
  const rows = await prisma.menuCategory.findMany({
    where: { branchId },
    orderBy: categoryOrder,
    select: { id: true }
  })
  const ids = rows.map((row) => row.id).filter((id) => id !== categoryId)
  const at = Math.max(0, Math.min(index, ids.length))
  ids.splice(at, 0, categoryId)
  await prisma.$transaction(ids.map((id, position) => prisma.menuCategory.update({ where: { id }, data: { sortOrder: position } })))
}

/** Closes gaps after a dish leaves a category so display order stays contiguous. */
async function compactItems(categoryId: string): Promise<void> {
  const rows = await prisma.menuItem.findMany({
    where: { categoryId },
    orderBy: itemOrder,
    select: { id: true }
  })
  if (rows.length === 0) return
  await prisma.$transaction(rows.map((row, position) => prisma.menuItem.update({ where: { id: row.id }, data: { sortOrder: position } })))
}

/** Inserts a dish at a 0-based position inside its category and rewrites every position. */
async function placeItem(categoryId: string, itemId: string, index: number): Promise<void> {
  const rows = await prisma.menuItem.findMany({
    where: { categoryId },
    orderBy: itemOrder,
    select: { id: true }
  })
  const ids = rows.map((row) => row.id).filter((id) => id !== itemId)
  const at = Math.max(0, Math.min(index, ids.length))
  ids.splice(at, 0, itemId)
  await prisma.$transaction(ids.map((id, position) => prisma.menuItem.update({ where: { id }, data: { sortOrder: position } })))
}

function assertFullSet(ids: string[], rows: Array<{ id: string }>, label: string): void {
  const expected = new Set(rows.map((row) => row.id))
  const seen = new Set(ids)
  if (seen.size !== ids.length || seen.size !== expected.size || ids.some((id) => !expected.has(id))) {
    throw new AppError(400, `The new ${label} order must include each ${label} on this branch once.`)
  }
}

function mappedWriteError(error: unknown, duplicateMessage: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new AppError(409, duplicateMessage)
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    return new AppError(409, 'That category still has menu items. Move them before deleting it.')
  }
  return error
}

// ============================================================================
// MODIFIER MANAGEMENT
// ============================================================================

const modifierGroupOrder = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }]
const modifierOptionOrder = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }]

/** Lists all modifier groups for a branch, including their options. */
export async function listModifierGroups(branchId: string): Promise<ModifierGroupDto[]> {
  const groups = await prisma.modifierGroup.findMany({
    where: { branchId },
    include: {
      options: {
        orderBy: modifierOptionOrder
      }
    },
    orderBy: modifierGroupOrder
  })
  return groups.map(toModifierGroupDto)
}

/** Creates a modifier group with validation. */
export async function createModifierGroup(branchId: string, input: ModifierGroupCreateInput): Promise<ModifierGroupDto[]> {
  const name = input.name.trim()
  if (!name) throw new AppError(400, 'Modifier group name is required')
  await assertModifierGroupName(branchId, name)

  // Validate selection constraints
  const minSelections = input.minSelections ?? 0
  const maxSelections = input.maxSelections ?? 1
  if (minSelections > maxSelections) {
    throw new AppError(400, 'Minimum selections cannot exceed maximum selections')
  }
  if (input.isRequired && minSelections === 0) {
    throw new AppError(400, 'Required modifier groups must have minimum selections greater than 0')
  }

  let createdId = ''
  try {
    const created = await prisma.modifierGroup.create({
      data: {
        branchId,
        name,
        description: input.description?.trim() ?? '',
        isRequired: input.isRequired ?? false,
        minSelections,
        maxSelections,
        isMultipleSelect: input.isMultipleSelect ?? (maxSelections > 1),
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true
      }
    })
    createdId = created.id
  } catch (error) {
    throw mappedWriteError(error, `A modifier group named "${name}" already exists. Use a different name.`)
  }

  await placeModifierGroup(branchId, createdId, input.sortOrder ?? Number.MAX_SAFE_INTEGER)
  publishMenu(branchId)
  return listModifierGroups(branchId)
}

/** Updates a modifier group. */
export async function updateModifierGroup(
  branchId: string,
  groupId: string,
  input: ModifierGroupUpdateInput
): Promise<ModifierGroupDto[]> {
  await requireModifierGroup(branchId, groupId)
  const name = input.name?.trim()
  if (input.name !== undefined && !name) throw new AppError(400, 'Modifier group name is required')
  if (name) await assertModifierGroupName(branchId, name, groupId)

  // Validate selection constraints if provided
  const currentGroup = await prisma.modifierGroup.findFirst({
    where: { id: groupId, branchId }
  })
  const minSelections = input.minSelections ?? currentGroup?.minSelections ?? 0
  const maxSelections = input.maxSelections ?? currentGroup?.maxSelections ?? 1
  if (minSelections > maxSelections) {
    throw new AppError(400, 'Minimum selections cannot exceed maximum selections')
  }
  const isRequired = input.isRequired ?? currentGroup?.isRequired ?? false
  if (isRequired && minSelections === 0) {
    throw new AppError(400, 'Required modifier groups must have minimum selections greater than 0')
  }

  try {
    await prisma.modifierGroup.update({
      where: { id: groupId },
      data: {
        ...(name ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
        ...(input.minSelections !== undefined ? { minSelections: input.minSelections } : {}),
        ...(input.maxSelections !== undefined ? { maxSelections: input.maxSelections } : {}),
        ...(input.isMultipleSelect !== undefined ? { isMultipleSelect: input.isMultipleSelect } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    })
  } catch (error) {
    throw mappedWriteError(error, `A modifier group named "${name ?? 'that'}" already exists. Use a different name.`)
  }

  if (input.sortOrder !== undefined) await placeModifierGroup(branchId, groupId, input.sortOrder)
  publishMenu(branchId)
  return listModifierGroups(branchId)
}

/** Deletes a modifier group and all its options. */
export async function deleteModifierGroup(branchId: string, groupId: string): Promise<ModifierGroupDto[]> {
  const group = await requireModifierGroup(branchId, groupId)
  
  // Check if group is assigned to any menu items
  const assignmentCount = await prisma.menuItemModifierGroup.count({ where: { modifierGroupId: groupId } })
  if (assignmentCount > 0) {
    throw new AppError(
      409,
      `"${group.name}" is assigned to ${assignmentCount} menu item${assignmentCount === 1 ? '' : 's'}. Remove assignments before deleting.`
    )
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.tombstone.create({
        data: { id: randomUUID(), branchId, entity: 'modifierGroup', entityId: groupId }
      })
      await tx.modifierGroup.delete({ where: { id: groupId } })
    })
  } catch (error) {
    throw mappedWriteError(error, 'Could not delete modifier group')
  }

  await compactModifierGroups(branchId)
  publishMenu(branchId)
  return listModifierGroups(branchId)
}

/** Creates a modifier option within a group. */
export async function createModifierOption(branchId: string, input: ModifierOptionCreateInput): Promise<ModifierGroupDto[]> {
  await requireModifierGroup(branchId, input.modifierGroupId)
  const name = input.name.trim()
  if (!name) throw new AppError(400, 'Modifier option name is required')
  await assertModifierOptionName(input.modifierGroupId, name)

  let createdId = ''
  try {
    const created = await prisma.modifierOption.create({
      data: {
        modifierGroupId: input.modifierGroupId,
        name,
        description: input.description?.trim() ?? '',
        priceCents: input.priceCents ?? 0,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true
      }
    })
    createdId = created.id
  } catch (error) {
    throw mappedWriteError(error, `"${name}" already exists in this modifier group. Use a different name.`)
  }

  await placeModifierOption(input.modifierGroupId, createdId, input.sortOrder ?? Number.MAX_SAFE_INTEGER)
  publishMenu(branchId)
  return listModifierGroups(branchId)
}

/** Updates a modifier option. */
export async function updateModifierOption(
  branchId: string,
  optionId: string,
  input: ModifierOptionUpdateInput
): Promise<ModifierGroupDto[]> {
  const option = await requireModifierOption(branchId, optionId)
  const name = input.name?.trim()
  if (input.name !== undefined && !name) throw new AppError(400, 'Modifier option name is required')
  if (name && name !== option.name) {
    await assertModifierOptionName(option.modifierGroupId, name, optionId)
  }

  try {
    await prisma.modifierOption.update({
      where: { id: optionId },
      data: {
        ...(name ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.priceCents !== undefined ? { priceCents: input.priceCents } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    })
  } catch (error) {
    throw mappedWriteError(error, `"${name ?? 'that option'}" already exists in this modifier group. Use a different name.`)
  }

  if (input.sortOrder !== undefined) {
    await placeModifierOption(option.modifierGroupId, optionId, input.sortOrder)
  }
  publishMenu(branchId)
  return listModifierGroups(branchId)
}

/** Deletes a modifier option. */
export async function deleteModifierOption(branchId: string, optionId: string): Promise<ModifierGroupDto[]> {
  const option = await requireModifierOption(branchId, optionId)
  
  // Check if option is used in any orders
  const usageCount = await prisma.orderItemModifier.count({ where: { modifierOptionId: optionId } })
  if (usageCount > 0) {
    throw new AppError(
      409,
      `"${option.name}" has been ordered ${usageCount} time${usageCount === 1 ? '' : 's'}. Deactivate it instead of deleting it so past orders stay intact.`
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.tombstone.create({
      data: { id: randomUUID(), branchId, entity: 'modifierOption', entityId: optionId }
    })
    await tx.modifierOption.delete({ where: { id: optionId } })
  })

  await compactModifierOptions(option.modifierGroupId)
  publishMenu(branchId)
  return listModifierGroups(branchId)
}

/** Assigns modifier groups to a menu item. */
export async function assignModifierGroups(
  branchId: string,
  menuItemId: string,
  input: MenuItemModifierAssignInput
): Promise<MenuCategoryDto[]> {
  await requireItem(branchId, menuItemId)

  // Validate all modifier groups exist and are active
  for (const groupId of input.modifierGroupIds) {
    await requireModifierGroup(branchId, groupId)
  }

  await prisma.$transaction(async (tx) => {
    // Remove existing assignments
    await tx.menuItemModifierGroup.deleteMany({ where: { menuItemId } })

    // Add new assignments
    for (const groupId of input.modifierGroupIds) {
      await tx.menuItemModifierGroup.create({
        data: {
          id: randomUUID(),
          menuItemId,
          modifierGroupId: groupId
        }
      })
    }
  })

  publishMenu(branchId)
  return listMenuManage(branchId)
}

// Helper functions for modifiers
async function requireModifierGroup(branchId: string, groupId: string) {
  const group = await prisma.modifierGroup.findFirst({ where: { id: groupId, branchId } })
  if (!group) throw new AppError(404, 'That modifier group is not on this branch')
  return group
}

async function requireModifierOption(branchId: string, optionId: string) {
  const option = await prisma.modifierOption.findFirst({
    where: { id: optionId, modifierGroup: { branchId } }
  })
  if (!option) throw new AppError(404, 'That modifier option is not on this branch')
  return option
}

async function assertModifierGroupName(branchId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.modifierGroup.findFirst({
    where: {
      branchId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      name: { equals: name, mode: 'insensitive' }
    },
    select: { name: true }
  })
  if (clash) {
    throw new AppError(409, `A modifier group named "${clash.name}" already exists. Use a different name.`)
  }
}

async function assertModifierOptionName(groupId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.modifierOption.findFirst({
    where: {
      modifierGroupId: groupId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      name: { equals: name, mode: 'insensitive' }
    },
    select: { name: true }
  })
  if (clash) {
    throw new AppError(409, `"${clash.name}" already exists in this modifier group. Use a different name.`)
  }
}

async function compactModifierGroups(branchId: string): Promise<void> {
  const rows = await prisma.modifierGroup.findMany({
    where: { branchId },
    orderBy: modifierGroupOrder,
    select: { id: true }
  })
  if (rows.length === 0) return
  await prisma.$transaction(
    rows.map((row, position) => prisma.modifierGroup.update({ where: { id: row.id }, data: { sortOrder: position } }))
  )
}

async function compactModifierOptions(groupId: string): Promise<void> {
  const rows = await prisma.modifierOption.findMany({
    where: { modifierGroupId: groupId },
    orderBy: modifierOptionOrder,
    select: { id: true }
  })
  if (rows.length === 0) return
  await prisma.$transaction(
    rows.map((row, position) => prisma.modifierOption.update({ where: { id: row.id }, data: { sortOrder: position } }))
  )
}

async function placeModifierGroup(branchId: string, groupId: string, index: number): Promise<void> {
  const rows = await prisma.modifierGroup.findMany({
    where: { branchId },
    orderBy: modifierGroupOrder,
    select: { id: true }
  })
  const ids = rows.map((row) => row.id).filter((id) => id !== groupId)
  const at = Math.max(0, Math.min(index, ids.length))
  ids.splice(at, 0, groupId)
  await prisma.$transaction(ids.map((id, position) => prisma.modifierGroup.update({ where: { id }, data: { sortOrder: position } })))
}

async function placeModifierOption(groupId: string, optionId: string, index: number): Promise<void> {
  const rows = await prisma.modifierOption.findMany({
    where: { modifierGroupId: groupId },
    orderBy: modifierOptionOrder,
    select: { id: true }
  })
  const ids = rows.map((row) => row.id).filter((id) => id !== optionId)
  const at = Math.max(0, Math.min(index, ids.length))
  ids.splice(at, 0, optionId)
  await prisma.$transaction(ids.map((id, position) => prisma.modifierOption.update({ where: { id }, data: { sortOrder: position } })))
}

function toModifierGroupDto(group: any): ModifierGroupDto {
  return {
    id: group.id,
    branchId: group.branchId,
    name: group.name,
    description: group.description,
    isRequired: group.isRequired,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    isMultipleSelect: group.isMultipleSelect,
    sortOrder: group.sortOrder,
    isActive: group.isActive,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    options: group.options.map((option: any) => ({
      id: option.id,
      modifierGroupId: option.modifierGroupId,
      name: option.name,
      description: option.description,
      priceCents: option.priceCents,
      sortOrder: option.sortOrder,
      isActive: option.isActive
    }))
  }
}
