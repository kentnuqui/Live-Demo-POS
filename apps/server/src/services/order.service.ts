import {
  ORDER_STATUSES,
  ORDER_TYPES,
  buildStationTicket,
  type AddItemsInput,
  type OrderCreateInput,
  type OrderPatchInput,
  type OrderStatus,
  type OrderType,
  type StationTicketDto
} from '@towns/shared'
import type { OrderDto } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { context, publish, type ServiceContext } from '../lib/context.js'
import { transaction, type Tx } from '../lib/transaction.js'
import { releaseTable } from './floor.service.js'
import { assertMutable, loadOrder, newId, orderInclude, present, progressFor, recalculate } from './order-support.js'

async function branchNames(tx: Parameters<typeof loadOrder>[0], branchId: string) {
  const [branch, profile] = await Promise.all([
    tx.branch.findUnique({ where: { id: branchId } }),
    tx.restaurantProfile.findFirst({ orderBy: { createdAt: 'asc' } })
  ])
  return {
    restaurantName: profile?.name ?? 'Towns',
    branchName: branch?.name ?? ''
  }
}

/**
 * Opens a check. Dine-in claims the table in the same transaction.
 * Passing an existing id returns that check, so an offline retry does not duplicate it.
 */
export async function createOrder(
  actor: AuthUser | null,
  branchId: string,
  input: OrderCreateInput,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const current = context(ctx)
  if (input.type === 'DINE_IN' && !input.tableId) throw new AppError(400, 'Choose a table')
  const guestName = input.guestName?.trim() || (input.type === 'TAKEOUT' ? 'Walk-in' : '')
  if (input.type === 'ONLINE' && !guestName) throw new AppError(400, 'Add a guest name')
  if (input.type === 'DELIVERY' && (!input.guestName?.trim() || !input.deliveryAddress?.trim())) {
    throw new AppError(400, 'Delivery needs a name and address')
  }

  const order = await transaction(current.db, async (tx) => {
    if (input.id) {
      const existing = await tx.order.findUnique({ where: { id: input.id }, include: orderInclude })
      if (existing) return existing
    }

    const settings = await tx.branchSettings.findUnique({ where: { branchId } })
    if (!settings) throw new AppError(404, 'Branch settings not found')

    if (input.tableId && !current.skipTableClaim) {
      const claimed = await tx.diningTable.updateMany({
        where: { id: input.tableId, branchId, status: { in: ['AVAILABLE', 'RESERVED'] } },
        data: { status: 'OCCUPIED' }
      })
      if (claimed.count !== 1) throw new AppError(409, 'That table is not open')
    } else if (input.tableId) {
      const table = await tx.diningTable.findFirst({ where: { id: input.tableId, branchId } })
      if (!table) throw new AppError(404, 'Table not found')
    }

    const created = await tx.order.create({
      data: {
        id: newId(input.id),
        branchId,
        type: input.type,
        source: input.source ?? 'POS',
        tableId: input.tableId,
        serverId: actor?.id,
        guestName,
        guestPhone: input.guestPhone?.trim() ?? '',
        guestCount: input.guestCount ?? (input.type === 'DINE_IN' ? 2 : 1),
        deliveryAddress: input.deliveryAddress?.trim() ?? '',
        notes: input.notes?.trim() ?? '',
        currency: settings.currency,
        status: 'OPEN',
        progress: 'SEATED'
      },
      include: orderInclude
    })
    return created
  })

  publish(current, branchId, 'order.updated', { orderId: order.id })
  if (input.tableId) publish(current, branchId, 'floor.updated', { tableId: input.tableId })
  return present(order)
}

function asStatus(value?: string): OrderStatus | undefined {
  if (!value) return undefined
  return ORDER_STATUSES.find((status) => status === value)
}

function asType(value?: string): OrderType | undefined {
  if (!value) return undefined
  return ORDER_TYPES.find((type) => type === value)
}

export async function listOrders(branchId: string, status?: string, type?: string) {
  const orders = await prisma.order.findMany({
    where: {
      branchId,
      status: asStatus(status),
      type: asType(type)
    },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
    take: 150
  })
  return orders.map(present)
}

export async function getOrder(orderId: string): Promise<OrderDto> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude })
  if (!order) throw new AppError(404, 'Order not found')
  return present(order)
}

/**
 * Updates guest details, or switches the check between dine-in and take-out.
 * Dine-in claims an open table. Take-out clears the table so the floor can turn it.
 */
export async function patchOrder(
  orderId: string,
  input: OrderPatchInput,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    assertMutable(existing.status)
    const seated = input.type ? await seatService(tx, existing, input.type, input.tableId) : null
    const guestName =
      input.guestName?.trim() ||
      (seated?.type === 'TAKEOUT' && !existing.guestName.trim() ? 'Walk-in' : input.guestName?.trim())
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        type: seated?.type,
        tableId: seated ? seated.tableId : undefined,
        guestCount: input.guestCount,
        guestName,
        guestPhone: input.guestPhone?.trim(),
        deliveryAddress: input.deliveryAddress?.trim(),
        notes: input.notes?.trim()
      },
      include: orderInclude
    })
    if (seated?.released) await releaseTable(tx, seated.released)
    return updated
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  if (input.type) publish(current, order.branchId, 'floor.updated')
  return present(order)
}

/**
 * Claims the next table before the old one is released, so a failed seat does not drop the party.
 */
async function seatService(
  tx: Tx,
  existing: { branchId: string; tableId: string | null },
  type: 'DINE_IN' | 'TAKEOUT',
  tableId: string | null | undefined
): Promise<{ type: 'DINE_IN' | 'TAKEOUT'; tableId: string | null; released: string | null }> {
  if (type === 'TAKEOUT') {
    return { type, tableId: null, released: existing.tableId }
  }
  const nextTable = tableId || existing.tableId
  if (!nextTable) throw new AppError(400, 'Choose a table')
  if (nextTable !== existing.tableId) {
    const claimed = await tx.diningTable.updateMany({
      where: { id: nextTable, branchId: existing.branchId, status: { in: ['AVAILABLE', 'RESERVED'] } },
      data: { status: 'OCCUPIED' }
    })
    if (claimed.count !== 1) throw new AppError(409, 'That table is not open')
  }
  return {
    type: 'DINE_IN',
    tableId: nextTable,
    released: existing.tableId && existing.tableId !== nextTable ? existing.tableId : null
  }
}

/**
 * How many of this line have already gone to the kitchen.
 * Older rows only stored sentAt, so a sent line with no fired count counts as fully fired.
 */
function firedCount(item: { quantity: number; firedQuantity: number; sentAt: Date | null }): number {
  if (item.firedQuantity > 0) return item.firedQuantity
  if (item.sentAt) return item.quantity
  return 0
}

/** Appends items. Items with modifiers create separate lines (no quantity merging for customized items). */
export async function addItems(
  orderId: string,
  input: AddItemsInput,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    assertMutable(existing.status)
    const known = new Set(existing.items.map((item) => item.id))
    const menuIds = [...new Set(input.items.map((item) => item.menuItemId))]
    const menu = await tx.menuItem.findMany({
      where: { id: { in: menuIds }, isAvailable: true, category: { branchId: existing.branchId, isActive: true } }
    })
    const byId = new Map(menu.map((item) => [item.id, item]))

    // Load modifier options for validation and price calculation
    const modifierOptionIds = input.items.flatMap(item => 
      item.modifiers?.map(mod => mod.modifierOptionId).filter(Boolean) || []
    )
    const modifierOptions = await tx.modifierOption.findMany({
      where: { id: { in: modifierOptionIds }, isActive: true },
      include: { modifierGroup: true }
    })
    const modifierById = new Map(modifierOptions.map(opt => [opt.id, opt]))

    for (const item of input.items) {
      const id = newId(item.id)
      if (known.has(id)) continue
      const dish = byId.get(item.menuItemId)
      if (!dish) throw new AppError(404, 'A dish is not on this menu')
      
      const notes = item.notes?.trim() ?? ''
      const modifiers = item.modifiers || []
      
      // Validate modifier selections
      if (modifiers.length > 0) {
        const groupSelections = new Map<string, number>()
        for (const mod of modifiers) {
          const option = modifierById.get(mod.modifierOptionId)
          if (!option) throw new AppError(404, 'Invalid modifier option')
          
          const groupId = option.modifierGroupId
          groupSelections.set(groupId, (groupSelections.get(groupId) || 0) + 1)
        }

        // Validate selection constraints for each group
        const groupIds = [...new Set(modifiers.map(m => modifierById.get(m.modifierOptionId)?.modifierGroupId).filter((id): id is string => Boolean(id)))]
        const groups = await tx.modifierGroup.findMany({
          where: { id: { in: groupIds } }
        })

        for (const group of groups) {
          const selectionCount = groupSelections.get(group.id) || 0
          
          if (group.isRequired && selectionCount < group.minSelections) {
            throw new AppError(400, `"${group.name}" requires at least ${group.minSelections} selection${group.minSelections === 1 ? '' : 's'}`)
          }
          
          if (selectionCount > group.maxSelections) {
            throw new AppError(400, `"${group.name}" allows maximum ${group.maxSelections} selection${group.maxSelections === 1 ? '' : 's'}`)
          }
        }
      }

      // Calculate total price including modifiers
      const modifierTotal = modifiers.reduce((sum, mod) => {
        const option = modifierById.get(mod.modifierOptionId)
        return sum + (option?.priceCents || 0)
      }, 0)
      const totalItemPrice = dish.priceCents + modifierTotal

      // For items with modifiers, always create new line (no merging)
      // For items without modifiers, try to merge with existing lines
      let shouldMerge = false
      let keepItem = null

      if (modifiers.length === 0) {
        const matches = existing.items.filter(
          (row) => !row.voided && 
                  row.menuItemId === dish.id && 
                  row.notes === notes && 
                  row.unitPriceCents === totalItemPrice
        )
        keepItem = matches[0]
        shouldMerge = !!keepItem
      }

      if (shouldMerge && keepItem) {
        const matches = existing.items.filter(
          (row) => !row.voided && row.menuItemId === dish.id && row.notes === notes && row.unitPriceCents === totalItemPrice
        )
        const rest = matches.slice(1)
        const extraQuantity = rest.reduce((sum, row) => sum + row.quantity, 0)
        const fired = firedCount(keepItem) + rest.reduce((sum, row) => sum + firedCount(row), 0)
        
        await tx.orderItem.update({
          where: { id: keepItem.id },
          data: {
            quantity: { increment: item.quantity + extraQuantity },
            firedQuantity: fired
          }
        })
        
        if (rest.length > 0) {
          await tx.orderItem.deleteMany({ where: { id: { in: rest.map((row) => row.id) } } })
        }
        
        keepItem.quantity += item.quantity + extraQuantity
        keepItem.firedQuantity = fired
        existing.items = existing.items.filter((row) => !rest.some((extra) => extra.id === row.id))
      } else {
        // Create new order item
        await tx.orderItem.create({
          data: {
            id,
            orderId,
            menuItemId: dish.id,
            name: dish.name,
            unitPriceCents: totalItemPrice,
            quantity: item.quantity,
            notes,
            station: dish.station
          }
        })

        // Add modifier records for the order item
        for (const mod of modifiers) {
          const option = modifierById.get(mod.modifierOptionId)
          if (option) {
            await tx.orderItemModifier.create({
              data: {
                id: newId(), // Generate new UUID for modifier
                orderItemId: id,
                modifierGroupId: mod.modifierGroupId,
                modifierOptionId: mod.modifierOptionId,
                modifierName: option.name,
                priceCents: option.priceCents
              }
            })
          }
        }
      }
      
      known.add(id)
    }
    
    await recalculate(tx, orderId)
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  return present(order)
}

/** Raises or lowers a line. At zero the line is voided so the check total drops. */
export async function adjustItemQuantity(
  orderId: string,
  itemId: string,
  delta: number,
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    assertMutable(existing.status)
    const item = existing.items.find((row) => row.id === itemId)
    if (!item || item.voided) throw new AppError(404, 'Item not found')
    const next = item.quantity + delta
    if (next <= 0) {
      await tx.orderItem.update({ where: { id: itemId }, data: { voided: true } })
    } else {
      const fired = Math.min(firedCount(item), next)
      await tx.orderItem.update({
        where: { id: itemId },
        data: { quantity: next, firedQuantity: fired }
      })
    }
    await recalculate(tx, orderId)
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  return present(order)
}

export async function voidItem(orderId: string, itemId: string, ctx?: Partial<ServiceContext>): Promise<OrderDto> {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    assertMutable(existing.status)
    const item = existing.items.find((row) => row.id === itemId)
    if (!item) throw new AppError(404, 'Item not found')
    if (item.voided) return existing
    await tx.orderItem.update({ where: { id: itemId }, data: { voided: true } })
    await recalculate(tx, orderId)
    return loadOrder(tx, orderId)
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  return present(order)
}

/**
 * Fires every unsent line to its station. Calling send again only prints the new lines.
 */
export async function sendOrder(
  orderId: string,
  ctx?: Partial<ServiceContext>
): Promise<{ order: OrderDto; tickets: StationTicketDto[] }> {
  const current = context(ctx)
  const result = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED' || existing.status === 'BILLING') {
      throw new AppError(409, 'This check can no longer be sent')
    }
    const fresh = existing.items.flatMap((item) => {
      if (item.voided) return []
      const delta = item.quantity - firedCount(item)
      if (delta <= 0) return []
      return [{ ...item, quantity: delta }]
    })
    if (fresh.length === 0) {
      if (existing.status !== 'OPEN') return { order: existing, tickets: [] }
      throw new AppError(400, 'Nothing new to send')
    }
    const now = new Date()
    for (const item of existing.items) {
      if (item.voided || item.quantity <= firedCount(item)) continue
      await tx.orderItem.update({
        where: { id: item.id },
        data: { sentAt: now, firedQuantity: item.quantity }
      })
    }
    const nextStatus = existing.status === 'OPEN' ? 'SENT' : existing.status
    await tx.order.update({
      where: { id: orderId },
      data: { status: nextStatus, progress: progressFor(nextStatus) }
    })
    const order = await loadOrder(tx, orderId)
    const names = await branchNames(tx, order.branchId)
    const when = now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })
    const stations = [...new Set(fresh.map((item) => item.station))]
    const tickets: StationTicketDto[] = stations.map((station) => ({
      station,
      lines: buildStationTicket(
        {
          restaurantName: names.restaurantName,
          branchName: names.branchName,
          tableLabel: order.table?.label ?? null,
          orderType: order.type,
          guestName: order.guestName,
          serverName: order.server ? `${order.server.firstName} ${order.server.lastName}` : null,
          showTable: true,
          showServer: true,
          when
        },
        station,
        fresh
          .filter((item) => item.station === station)
          .map((item) => ({ quantity: item.quantity, name: item.name, notes: item.notes }))
      )
    }))
    return { order, tickets }
  })
  publish(current, result.order.branchId, 'order.updated', { orderId })
  return { order: present(result.order), tickets: result.tickets }
}

/** Moves kitchen-facing status forward. Never backward. */
export async function advanceOrder(
  orderId: string,
  status: 'PREPARING' | 'READY' | 'SERVED',
  ctx?: Partial<ServiceContext>
): Promise<OrderDto> {
  const rank: Record<string, number> = { SENT: 1, PREPARING: 2, READY: 3, SERVED: 4 }
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const existing = await loadOrder(tx, orderId)
    const from = rank[existing.status]
    const to = rank[status]
    if (from === undefined || to === undefined || to < from) {
      throw new AppError(409, 'That step is not available')
    }
    return tx.order.update({
      where: { id: orderId },
      data: { status, progress: progressFor(status) },
      include: orderInclude
    })
  })
  publish(current, order.branchId, 'order.updated', { orderId })
  return present(order)
}

export async function assertOrderBranch(orderId: string, branchId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { branchId: true } })
  if (!order) throw new AppError(404, 'Order not found')
  if (order.branchId !== branchId) throw new AppError(403, 'Outside your branch')
}
