import type { Prisma } from '@prisma/client'
import {
  OPEN_ORDER_STATUSES,
  ORDER_TYPE_LABEL,
  type OrderListDto,
  type OrderListQuery,
  type OrderType
} from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { shiftDay, startOfMonth, startOfWeek, todayInTimeZone, zonedDayRange } from '../lib/day.js'
import { prisma } from '../lib/prisma.js'
import { orderInclude, present } from './order-support.js'

const PAGE_SIZE = 25
const MAX_RANGE_DAYS = 370

const TYPE_PHRASES: Array<{ phrase: string; type: OrderType }> = [
  ...(Object.entries(ORDER_TYPE_LABEL) as Array<[OrderType, string]>).flatMap(([type, label]) => {
    const phrase = label.toLowerCase()
    const compact = phrase.replace(/\s+/g, '')
    const phrases = phrase === compact ? [phrase] : [phrase, compact]
    return phrases.map((item) => ({ phrase: item, type }))
  }),
  { phrase: 'dine', type: 'DINE_IN' },
  { phrase: 'dine-in', type: 'DINE_IN' },
  { phrase: 'take-out', type: 'TAKEOUT' },
  { phrase: 'takeaway', type: 'TAKEOUT' }
]

/**
 * One page of checks for the orders board.
 * Active checks stay on the open statuses. Ready to serve is the floor state the pass writes.
 * Dates are calendar days in the branch timezone, the same clock the kitchen and sales report use.
 * The unfiltered list endpoint is left unchanged for the floor tools that still read it.
 */
export async function queryOrders(branchId: string, input: OrderListQuery): Promise<OrderListDto> {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } })
  if (!branch) throw new AppError(404, 'Branch not found')
  const timezone = safeZone(branch.timezone)
  const scope = input.scope
  const focus = focusFor(scope, input.focus)
  const pageSize = input.pageSize || PAGE_SIZE
  const page = input.page
  const where: Prisma.OrderWhereInput = {
    branchId,
    AND: compact([
      scopeWhere(scope),
      focusWhere(focus),
      dateWhere(scope, timezone, input),
      input.type ? { type: input.type } : undefined,
      searchWhere(input.q)
    ])
  }
  const today = zonedDayRange(todayInTimeZone(timezone), timezone)
  const [rows, total, active, readyToServe, completedToday] = await Promise.all([
    prisma.order.findMany({
      where,
      include: orderInclude,
      orderBy: scope === 'past' ? [{ closedAt: 'desc' }, { createdAt: 'desc' }] : [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { branchId, status: { in: [...OPEN_ORDER_STATUSES] } } }),
    prisma.order.count({
      where: { branchId, serviceStatus: 'READY_TO_SERVE', status: { in: [...OPEN_ORDER_STATUSES] } }
    }),
    prisma.order.count({
      where: { branchId, status: 'COMPLETED', closedAt: { gte: today.start, lt: today.end } }
    })
  ])
  return {
    orders: rows.map(present),
    page,
    pageSize,
    total,
    timezone,
    summary: { active, readyToServe, completedToday }
  }
}

function focusFor(scope: OrderListQuery['scope'], focus: OrderListQuery['focus']): OrderListQuery['focus'] {
  if (scope === 'active' && (focus === 'completed' || focus === 'cancelled')) return 'all'
  if (scope === 'past' && focus !== 'all' && focus !== 'completed' && focus !== 'cancelled') return 'all'
  return focus
}

function scopeWhere(scope: OrderListQuery['scope']): Prisma.OrderWhereInput {
  if (scope === 'past') return { status: { in: ['COMPLETED', 'CANCELLED'] } }
  return { status: { in: [...OPEN_ORDER_STATUSES] } }
}

/**
 * Lenses over stored fields.
 * New is a check the pass has not started. Preparing and Ready to serve read `serviceStatus`,
 * which the kitchen writes when a ticket moves. Billing, completed, and cancelled are check statuses.
 */
function focusWhere(focus: OrderListQuery['focus']): Prisma.OrderWhereInput | undefined {
  switch (focus) {
    case 'all':
      return undefined
    case 'new':
      return { status: { in: ['OPEN', 'SENT'] }, serviceStatus: null }
    case 'preparing':
      return {
        OR: [{ serviceStatus: 'PREPARING' }, { status: 'PREPARING', serviceStatus: null }]
      }
    case 'ready':
      return { serviceStatus: 'READY_TO_SERVE' }
    case 'billing':
      return { status: 'BILLING' }
    case 'completed':
      return { status: 'COMPLETED' }
    case 'cancelled':
      return { status: 'CANCELLED' }
    default:
      return undefined
  }
}

function dateWhere(
  scope: OrderListQuery['scope'],
  timezone: string,
  input: OrderListQuery
): Prisma.OrderWhereInput | undefined {
  const window = dateWindow(timezone, input)
  if (!window) return undefined
  const span = { gte: window.start, lt: window.end }
  return scope === 'past' ? { closedAt: span } : { createdAt: span }
}

function dateWindow(timezone: string, input: OrderListQuery): { start: Date; end: Date } | null {
  const today = todayInTimeZone(timezone)
  try {
    if (input.range === 'today') return zonedDayRange(today, timezone)
    if (input.range === 'yesterday') return zonedDayRange(shiftDay(today, -1), timezone)
    if (input.range === 'week') {
      return { start: zonedDayRange(startOfWeek(today), timezone).start, end: zonedDayRange(today, timezone).end }
    }
    if (input.range === 'month') {
      return { start: zonedDayRange(startOfMonth(today), timezone).start, end: zonedDayRange(today, timezone).end }
    }
    if (input.range !== 'custom' && !input.from && !input.to) return null
    const startDay = input.from ?? input.to
    const endDay = input.to ?? input.from
    if (!startDay || !endDay) return null
    const from = startDay <= endDay ? startDay : endDay
    const to = startDay <= endDay ? endDay : startDay
    if (inclusiveDays(from, to) > MAX_RANGE_DAYS) throw new AppError(400, 'Choose a shorter date range')
    return { start: zonedDayRange(from, timezone).start, end: zonedDayRange(to, timezone).end }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(400, 'Choose a valid date')
  }
}

function searchWhere(q: string | undefined): Prisma.OrderWhereInput | undefined {
  const term = q?.trim() ?? ''
  if (!term) return undefined
  const or: Prisma.OrderWhereInput[] = [
    { guestName: { contains: term, mode: 'insensitive' } },
    { guestPhone: { contains: term, mode: 'insensitive' } },
    { table: { label: { contains: term, mode: 'insensitive' } } },
    { server: { firstName: { contains: term, mode: 'insensitive' } } },
    { server: { lastName: { contains: term, mode: 'insensitive' } } }
  ]
  const words = term.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    or.push({
      server: {
        firstName: { contains: words[0], mode: 'insensitive' },
        lastName: { contains: words.slice(1).join(' '), mode: 'insensitive' }
      }
    })
  }
  const ticketText = term.replace(/^#/, '')
  if (/^\d+$/.test(ticketText)) {
    const ticket = Number(ticketText)
    if (ticket > 0 && ticket <= 2_147_483_647) or.push({ ticketNumber: ticket })
  }
  const type = TYPE_PHRASES.find((item) => item.phrase === term.toLowerCase())?.type
  if (type) or.push({ type })
  return { OR: or }
}

function inclusiveDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000) + 1
}

function safeZone(timeZone: string): string {
  try {
    todayInTimeZone(timeZone)
    return timeZone
  } catch {
    return 'UTC'
  }
}

function compact(parts: Array<Prisma.OrderWhereInput | undefined>): Prisma.OrderWhereInput[] {
  return parts.filter((part): part is Prisma.OrderWhereInput => part !== undefined)
}
