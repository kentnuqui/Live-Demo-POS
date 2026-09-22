import { OPEN_ORDER_STATUSES, type QrOrderInput } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { publish, context } from '../lib/context.js'
import { transaction } from '../lib/transaction.js'
import { listMenu } from './menu.service.js'
import { addItems, createOrder } from './order.service.js'
import { orderInclude, present } from './order-support.js'

/** Public table page: restaurant, menu, and the check already open at that table. */
export async function getQrContext(token: string) {
  const qr = await prisma.qrToken.findUnique({
    where: { token },
    include: { table: true, branch: true }
  })
  if (!qr?.isActive) throw new AppError(404, 'This table code is not active')
  const profile = await prisma.restaurantProfile.findFirst({ orderBy: { createdAt: 'asc' } })
  const menu = await listMenu(qr.branchId)
  const settings = await prisma.branchSettings.findUnique({ where: { branchId: qr.branchId } })
  const open = await prisma.order.findFirst({
    where: { tableId: qr.tableId, status: { in: [...OPEN_ORDER_STATUSES] } },
    include: orderInclude,
    orderBy: { createdAt: 'desc' }
  })
  return {
    token: qr.token,
    branchId: qr.branchId,
    branchName: qr.branch.name,
    restaurantName: profile?.name ?? qr.branch.name,
    tableId: qr.tableId,
    tableLabel: qr.table.label,
    currency: settings?.currency ?? 'USD',
    menu,
    order: open ? present(open) : null
  }
}

/**
 * Guest order. If the table already has an open check, the dishes are added to it.
 * Otherwise a QR check is opened and the table becomes occupied.
 */
export async function placeQrOrder(token: string, input: QrOrderInput) {
  const qr = await prisma.qrToken.findUnique({ where: { token } })
  if (!qr?.isActive) throw new AppError(404, 'This table code is not active')

  const order = await transaction(prisma, async (tx) => {
    const open = await tx.order.findFirst({
      where: { tableId: qr.tableId, status: { in: [...OPEN_ORDER_STATUSES] } },
      orderBy: { createdAt: 'desc' }
    })
    const current = open
      ? open
      : await createOrder(
          null,
          qr.branchId,
          {
            type: 'QR',
            source: 'QR',
            tableId: qr.tableId,
            guestName: input.guestName,
            guestCount: 2
          },
          { db: tx, silent: true }
        )
    if (input.guestName && open) {
      await tx.order.update({ where: { id: open.id }, data: { guestName: input.guestName } })
    }
    return addItems(
      current.id,
      { items: input.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity, notes: item.notes })) },
      { db: tx, silent: true }
    )
  })

  publish(context(), qr.branchId, 'order.updated', { orderId: order.id })
  publish(context(), qr.branchId, 'floor.updated', { tableId: qr.tableId })
  return order
}
