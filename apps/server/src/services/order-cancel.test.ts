import assert from 'node:assert/strict'
import {
  cancelOrderSchema,
  cancelReasonText,
  cancelSuccessMessage,
  hasPermission,
  orderCancelBlock
} from '@towns/shared'

/**
 * Order cancellation rules.
 * Cancelling never moves money, and a cancelled check is never cancelled twice.
 * Run with: npx tsx src/services/order-cancel.test.ts
 */
function run(): void {
  for (const status of ['OPEN', 'SENT', 'PREPARING', 'READY', 'SERVED', 'BILLING'] as const) {
    assert.equal(orderCancelBlock({ status, paidCents: 0 }), null, `${status} with no payment can be cancelled`)
  }
  assert.equal(orderCancelBlock({ status: 'CANCELLED', paidCents: 0 }), 'This order has already been cancelled.')
  assert.match(orderCancelBlock({ status: 'COMPLETED', paidCents: 4500 }) ?? '', /Refund/)
  assert.match(orderCancelBlock({ status: 'BILLING', paidCents: 1000 }) ?? '', /payment was already taken/)

  assert.equal(cancelReasonText('CUSTOMER_CANCELLED'), 'Customer cancelled')
  assert.equal(cancelReasonText('OTHER', '  Fire alarm  '), 'Other: Fire alarm')
  assert.equal(cancelReasonText('KITCHEN_ISSUE', 'Out of buns'), 'Kitchen issue: Out of buns')

  assert.equal(cancelOrderSchema.safeParse({ reason: 'OTHER' }).success, false)
  assert.equal(cancelOrderSchema.safeParse({ reason: 'OTHER', note: '   ' }).success, false)
  assert.equal(cancelOrderSchema.safeParse({ reason: 'OTHER', note: 'Left early' }).success, true)
  assert.equal(cancelOrderSchema.safeParse({ reason: 'WRONG_ORDER' }).success, true)
  assert.equal(cancelOrderSchema.safeParse({ reason: 'NOPE' }).success, false)
  assert.equal(cancelOrderSchema.safeParse({ reason: 'WRONG_ORDER', overridePin: '12' }).success, false)

  assert.equal(
    cancelSuccessMessage('Order #10025', { label: '05', status: 'AVAILABLE' }),
    'Order #10025 cancelled successfully. Table 05 is now available.'
  )
  assert.equal(
    cancelSuccessMessage('Order #10025', { label: '05', status: 'OCCUPIED' }),
    'Order #10025 cancelled successfully. Table 05 remains occupied by another active order.'
  )
  assert.equal(
    cancelSuccessMessage('Order #10025', { label: '05', status: 'BILLING' }),
    'Order #10025 cancelled successfully. Table 05 remains occupied by another active order.'
  )
  assert.match(cancelSuccessMessage('Order #1', { label: '2', status: 'RESERVED' }), /reservation/)
  assert.equal(cancelSuccessMessage('Order #7', null), 'Order #7 cancelled successfully.')

  assert.equal(hasPermission('RESTAURANT_MANAGER', 'orders.cancel'), true)
  assert.equal(hasPermission('ADMIN', 'orders.cancel'), true)
  assert.equal(hasPermission('CASHIER', 'orders.cancel'), false)
  assert.equal(hasPermission('WAITER', 'orders.cancel'), false)
  assert.equal(hasPermission('KITCHEN_STAFF', 'orders.cancel'), false)

  console.log('order-cancel: ok')
}

run()
