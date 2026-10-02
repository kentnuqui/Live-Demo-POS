import assert from 'node:assert/strict'
import {
  aggregateKitchenStatus,
  allocateCancellation,
  buildStationTicket,
  firedCount,
  formatKitchenLines,
  kitchenSendMessage,
  linesToFire,
  submissionKind,
  unsentQuantity
} from '@towns/shared'

/**
 * Incremental kitchen firing.
 * Previously sent quantities must never be treated as a new cook.
 * Run with: npx tsx src/services/kitchen-fire.test.ts
 */
function run(): void {
  assert.equal(firedCount({ quantity: 3, firedQuantity: 0, sentAt: 'sent' }), 3)
  assert.equal(firedCount({ quantity: 4, firedQuantity: 2, sentAt: 'sent' }), 2)
  assert.equal(firedCount({ quantity: 1, firedQuantity: 0, sentAt: null }), 0)

  const burger = { name: 'Burger', quantity: 1, firedQuantity: 1, sentAt: 'sent', voided: false }
  const fries = { name: 'Fries', quantity: 1, firedQuantity: 0, sentAt: null, voided: false }
  const first = linesToFire([burger, fries])
  assert.equal(first.length, 1)
  assert.equal(first[0]?.name, 'Fries')
  assert.equal(first[0]?.quantity, 1)
  assert.equal(burger.quantity, 1)

  const increased = { name: 'Burger', quantity: 2, firedQuantity: 1, sentAt: 'sent', voided: false }
  const extra = linesToFire([increased])
  assert.equal(extra.length, 1)
  assert.equal(extra[0]?.quantity, 1)
  assert.equal(increased.firedQuantity, 1)

  const wings = { name: 'Wings', quantity: 1, firedQuantity: 0, sentAt: null, voided: false }
  const tea = { name: 'Tea', quantity: 1, firedQuantity: 0, sentAt: null, voided: false }
  assert.deepEqual(linesToFire([wings]).map((line) => line.name), ['Wings'])
  assert.deepEqual(linesToFire([{ ...wings, firedQuantity: 1, sentAt: 'sent' }, tea]).map((line) => line.name), ['Tea'])

  const modified = {
    name: 'Burger',
    quantity: 1,
    firedQuantity: 0,
    sentAt: null,
    voided: false,
    notes: 'EXTRA SPICY',
    modifiers: [{ modifierName: 'No Onion', priceCents: 0 }]
  }
  const kept = linesToFire([modified])
  assert.equal(kept[0]?.notes, 'EXTRA SPICY')
  assert.equal(kept[0]?.modifiers[0]?.modifierName, 'No Onion')

  assert.equal(unsentQuantity({ quantity: 2, firedQuantity: 3, sentAt: 'sent' }), 0)
  assert.deepEqual(linesToFire([{ name: 'Burger', quantity: 2, firedQuantity: 3, sentAt: 'sent' }]), [])
  assert.equal(unsentQuantity({ quantity: 1, firedQuantity: 0, sentAt: null, voided: true }), 0)

  assert.equal(submissionKind(0), 'INITIAL')
  assert.equal(submissionKind(1), 'ADDITION')
  assert.equal(submissionKind(3), 'ADDITION')

  assert.equal(kitchenSendMessage(0), 'No new items to send.')
  assert.equal(kitchenSendMessage(1), '1 new item sent to kitchen.')
  assert.equal(kitchenSendMessage(3), '3 new items sent to kitchen.')
  assert.equal(formatKitchenLines([{ name: 'Burger', quantity: 1 }, { name: 'Fries', quantity: 2 }]), 'Burger ×1, Fries ×2')

  assert.equal(aggregateKitchenStatus([]), null)
  assert.equal(aggregateKitchenStatus(['NEW']), 'NEW')
  assert.equal(aggregateKitchenStatus(['COMPLETED', 'NEW']), 'NEW')
  assert.equal(aggregateKitchenStatus(['PREPARING', 'NEW']), 'PREPARING')
  assert.equal(aggregateKitchenStatus(['READY', 'READY']), 'READY')
  assert.equal(aggregateKitchenStatus(['COMPLETED', 'COMPLETED']), 'COMPLETED')

  const cancelled = allocateCancellation(
    [
      { id: 'new', orderItemId: 'burger', quantity: 1, cancelledQuantity: 0 },
      { id: 'old', orderItemId: 'burger', quantity: 1, cancelledQuantity: 0 },
      { id: 'fries', orderItemId: 'fries', quantity: 1, cancelledQuantity: 0 }
    ],
    'burger',
    1
  )
  assert.equal(cancelled[0]?.cancelledQuantity, 1)
  assert.equal(cancelled[1]?.cancelledQuantity, 0)
  assert.equal(cancelled[2]?.cancelledQuantity, 0)
  assert.equal(cancelled[0]?.quantity, 1)

  const chit = buildStationTicket(
    {
      restaurantName: 'Towns',
      branchName: 'Shibuya',
      tableLabel: 'T-05',
      orderType: 'DINE_IN',
      guestName: '',
      serverName: 'John',
      showTable: true,
      showServer: true,
      when: '10:42 PM',
      ticketNumber: 1001,
      addition: true
    },
    'KITCHEN',
    [{ quantity: 1, name: 'Chicken Wings', notes: 'EXTRA SPICY', modifiers: [{ modifierName: 'No Onion', priceCents: 0 }] }]
  )
  assert.ok(chit.includes('ADDITIONAL ORDER'))
  assert.ok(chit.includes('Order #1001'))
  assert.ok(chit.includes('Table T-05'))
  assert.ok(chit.includes('Server John'))
  assert.ok(chit.some((line) => line.includes('Chicken Wings')))
  assert.ok(chit.some((line) => line.includes('No Onion')))
  assert.ok(chit.some((line) => line.includes('EXTRA SPICY')))
  assert.equal(chit.some((line) => line.includes('Burger')), false)

  const original = buildStationTicket(
    {
      restaurantName: 'Towns',
      branchName: 'Shibuya',
      tableLabel: null,
      orderType: 'TAKEOUT',
      guestName: '',
      serverName: null,
      showTable: true,
      showServer: true,
      when: '10:10 PM'
    },
    'KITCHEN',
    [{ quantity: 1, name: 'Burger', notes: '' }]
  )
  assert.equal(original.includes('ADDITIONAL ORDER'), false)
  assert.ok(original.some((line) => line.includes('Burger')))
}

run()
console.log('kitchen-fire tests passed')
