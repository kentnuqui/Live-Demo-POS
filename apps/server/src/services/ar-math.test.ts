import assert from 'node:assert/strict'
import {
  addAging,
  agingBucket,
  calendarDaysBetween,
  creditDecision,
  dayMoney,
  emptyAging,
  invoiceRemaining,
  invoiceStatus,
  reviewAllocations,
  termDays
} from '@towns/shared'
import { shiftDay } from '../lib/day.js'

/**
 * Financial cases for account sales. Amounts are integer cents.
 * Run with: npx tsx src/services/ar-math.test.ts
 */
function run(): void {
  assert.equal(invoiceRemaining({ originalCents: 10000, paidCents: 0, refundedCents: 0, writtenOffCents: 0, voided: false }), 10000)

  assert.equal(invoiceRemaining({ originalCents: 10000, paidCents: 4000, refundedCents: 0, writtenOffCents: 0, voided: false }), 6000)

  const paid = { originalCents: 10000, paidCents: 10000, refundedCents: 0, writtenOffCents: 0, voided: false }
  assert.equal(invoiceRemaining(paid), 0)
  assert.equal(invoiceStatus({ ...paid, dueOn: '2026-11-01', today: '2026-10-02' }), 'PAID')

  const lines = [
    { invoiceId: 'a', amountCents: 10000 },
    { invoiceId: 'b', amountCents: 15000 }
  ]
  const reviewed = reviewAllocations(25000, lines, new Map([['a', 10000], ['b', 20000], ['c', 30000]]))
  assert.equal(reviewed.ok, true)
  if (!reviewed.ok) return
  const remainings = new Map([['a', 10000 - 10000], ['b', 20000 - 15000], ['c', 30000]])
  assert.equal([...remainings.values()].reduce((sum, value) => sum + value, 0), 35000)

  const blocked = creditDecision({ limitCents: 50000, enforce: true, balanceCents: 45000, requestedCents: 10000 })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) assert.equal(blocked.availableCents, 5000)

  const day = dayMoney({
    cashSales: 50000,
    cardSales: 0,
    otherSales: 0,
    arSales: 20000,
    cashCollections: 0,
    cardCollections: 0,
    otherCollections: 0,
    cashRefunds: 0,
    cardRefunds: 0,
    otherRefunds: 0,
    accountRefunds: 0
  })
  assert.equal(day.salesCents, 70000)
  assert.equal(day.cashDrawerCents, 50000)
  assert.equal(day.arSalesCents, 20000)

  const collected = dayMoney({
    cashSales: 0,
    cardSales: 0,
    otherSales: 0,
    arSales: 0,
    cashCollections: 10000,
    cardCollections: 0,
    otherCollections: 0,
    cashRefunds: 0,
    cardRefunds: 0,
    otherRefunds: 0,
    accountRefunds: 0
  })
  assert.equal(collected.cashDrawerCents, 10000)
  assert.equal(collected.salesCents, 0)
  assert.equal(invoiceRemaining({ originalCents: 20000, paidCents: 10000, refundedCents: 0, writtenOffCents: 0, voided: false }), 10000)

  assert.equal(termDays('NET_30', 0), 30)
  assert.equal(shiftDay('2026-10-02', 30), '2026-11-01')

  assert.equal(agingBucket('2026-11-01', '2026-10-02'), 'current')
  assert.equal(agingBucket('2026-09-01', '2026-10-02'), 'd31_60')
  assert.equal(calendarDaysBetween('2026-09-01', '2026-10-02'), 31)

  const overduePartial = invoiceStatus({
    originalCents: 10000,
    paidCents: 4000,
    refundedCents: 0,
    writtenOffCents: 0,
    voided: false,
    dueOn: '2026-09-01',
    today: '2026-10-02'
  })
  assert.equal(overduePartial, 'OVERDUE')

  const over = reviewAllocations(10000, [{ invoiceId: 'a', amountCents: 15000 }], new Map([['a', 20000]]))
  assert.equal(over.ok, false)

  let aging = emptyAging()
  aging = addAging(aging, 'd90', 500)
  assert.equal(aging.days90PlusCents, 500)
  assert.equal(aging.totalCents, 500)

  console.log('AR financial checks passed')
}

const isMain = process.argv[1]?.includes('ar-math.test')
if (isMain) run()
