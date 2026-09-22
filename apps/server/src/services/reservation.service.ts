import type { ReservationInput, SeatInput } from '@towns/shared'
import type { AuthUser } from '../middleware/auth.js'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { context, publish, type ServiceContext } from '../lib/context.js'
import { toReservationDto } from '../lib/mappers.js'
import { transaction } from '../lib/transaction.js'
import { reconcileTable } from './floor.service.js'
import { createOrder } from './order.service.js'

const reservationInclude = { table: { select: { label: true } } }

/** Reservations overlapping a window. Defaults to yesterday through the next two days. */
export async function listReservations(branchId: string, from?: string, to?: string) {
  const start = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000)
  const end = to ? new Date(to) : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  const rows = await prisma.reservation.findMany({
    where: { branchId, reservedAt: { gte: start, lte: end } },
    include: reservationInclude,
    orderBy: { reservedAt: 'asc' }
  })
  return rows.map(toReservationDto)
}

/** Saves a walk-in or an advance booking. A client id makes the write safe to retry offline. */
export async function createReservation(branchId: string, input: ReservationInput, ctx?: Partial<ServiceContext>) {
  const current = context(ctx)
  const row = await transaction(current.db, async (tx) => {
    if (input.id) {
      const existing = await tx.reservation.findUnique({ where: { id: input.id }, include: reservationInclude })
      if (existing) return existing
    }
    if (input.tableId) {
      const table = await tx.diningTable.findFirst({ where: { id: input.tableId, branchId } })
      if (!table) throw new AppError(404, 'Table not found')
    }
    const created = await tx.reservation.create({
      data: {
        id: input.id,
        branchId,
        tableId: input.tableId ?? null,
        type: input.type,
        status: 'CONFIRMED',
        guestName: input.guestName.trim(),
        guestPhone: input.guestPhone?.trim() ?? '',
        guestCount: input.guestCount,
        reservedAt: new Date(input.reservedAt),
        durationMinutes: input.durationMinutes ?? 90,
        depositAmountCents: input.depositAmountCents ?? 0,
        depositPaid: input.depositPaid ?? false,
        notes: input.notes?.trim() ?? ''
      },
      include: reservationInclude
    })
    if (created.tableId) await reconcileTable(tx, created.tableId)
    return created
  })
  publish(current, branchId, 'reservation.updated', { reservationId: row.id })
  publish(current, branchId, 'floor.updated')
  return toReservationDto(row)
}

/** Seats the party and opens their check. */
export async function seatReservation(
  actor: AuthUser,
  branchId: string,
  reservationId: string,
  input: SeatInput,
  ctx?: Partial<ServiceContext>
) {
  const current = context(ctx)
  const order = await transaction(current.db, async (tx) => {
    const reservation = await tx.reservation.findFirst({ where: { id: reservationId, branchId } })
    if (!reservation) throw new AppError(404, 'Reservation not found')
    if (reservation.status === 'SEATED') {
      const existing = await tx.order.findFirst({
        where: { branchId, guestName: reservation.guestName, tableId: reservation.tableId ?? undefined },
        orderBy: { createdAt: 'desc' }
      })
      if (existing) return createOrder(actor, branchId, { id: existing.id, type: 'DINE_IN', tableId: existing.tableId ?? undefined }, { db: tx, silent: true, skipTableClaim: true })
    }
    if (reservation.status !== 'CONFIRMED' && reservation.status !== 'PENDING') {
      throw new AppError(409, 'This reservation cannot be seated')
    }
    const tableId = input.tableId ?? reservation.tableId
    if (!tableId) throw new AppError(400, 'Assign a table before seating')
    if (input.tableId && input.tableId !== reservation.tableId) {
      await tx.reservation.update({ where: { id: reservationId }, data: { tableId: input.tableId } })
    }
    const created = await createOrder(
      actor,
      branchId,
      {
        type: 'DINE_IN',
        tableId,
        guestCount: reservation.guestCount,
        guestName: reservation.guestName,
        guestPhone: reservation.guestPhone,
        notes: reservation.notes
      },
      { db: tx, silent: true }
    )
    await tx.reservation.update({ where: { id: reservationId }, data: { status: 'SEATED', tableId } })
    return created
  })
  publish(current, branchId, 'reservation.updated')
  publish(current, branchId, 'floor.updated')
  return order
}

export async function cancelReservation(branchId: string, reservationId: string, ctx?: Partial<ServiceContext>) {
  const current = context(ctx)
  const row = await transaction(current.db, async (tx) => {
    const reservation = await tx.reservation.findFirst({ where: { id: reservationId, branchId } })
    if (!reservation) throw new AppError(404, 'Reservation not found')
    const updated = await tx.reservation.update({
      where: { id: reservationId },
      data: { status: 'CANCELLED' },
      include: reservationInclude
    })
    if (reservation.tableId) await reconcileTable(tx, reservation.tableId)
    return updated
  })
  publish(current, branchId, 'reservation.updated')
  publish(current, branchId, 'floor.updated')
  return toReservationDto(row)
}
