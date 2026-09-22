import bcrypt from 'bcryptjs'
import { PrismaClient, type MenuStation, type TableShape, type TableZone } from '@prisma/client'
import { priceItems } from '@towns/shared'
import '../src/config/env.js'
import { pinLookup } from '../src/lib/pin.js'
import { seedModifiers } from './seed-modifiers.js'

const prisma = new PrismaClient()

interface Dish {
  name: string
  description: string
  priceCents: number
  station: MenuStation
}

const MENU: Array<{ name: string; items: Dish[] }> = [
  {
    name: 'Sushi',
    items: [
      { name: 'Salmon nigiri', description: 'Two pieces', priceCents: 600, station: 'SUSHI' },
      { name: 'Tuna nigiri', description: 'Two pieces', priceCents: 700, station: 'SUSHI' },
      { name: 'Yellowtail nigiri', description: 'Two pieces', priceCents: 700, station: 'SUSHI' },
      { name: 'Cucumber roll', description: 'Six pieces', priceCents: 800, station: 'SUSHI' },
      { name: 'Chef set', description: 'Eight pieces, chef’s choice', priceCents: 2800, station: 'SUSHI' }
    ]
  },
  {
    name: 'Ramen',
    items: [
      { name: 'Shoyu ramen', description: 'Soy broth, chashu, nori', priceCents: 1600, station: 'KITCHEN' },
      { name: 'Miso ramen', description: 'Fermented bean broth', priceCents: 1700, station: 'KITCHEN' },
      { name: 'Tonkotsu ramen', description: 'Pork broth, egg', priceCents: 1800, station: 'KITCHEN' }
    ]
  },
  {
    name: 'Donburi',
    items: [
      { name: 'Chicken don', description: 'Rice bowl, sweet soy', priceCents: 1500, station: 'KITCHEN' },
      { name: 'Unagi don', description: 'Grilled eel', priceCents: 2600, station: 'KITCHEN' }
    ]
  },
  {
    name: 'Tempura',
    items: [
      { name: 'Vegetable tempura', description: 'Seasonal', priceCents: 1200, station: 'KITCHEN' },
      { name: 'Prawn tempura', description: 'Three pieces', priceCents: 1600, station: 'KITCHEN' }
    ]
  },
  {
    name: 'Drinks',
    items: [
      { name: 'Green tea', description: 'Hojicha', priceCents: 300, station: 'BAR' },
      { name: 'Coffee', description: 'Filter', priceCents: 400, station: 'BAR' },
      { name: 'Highball', description: 'Whisky, soda', priceCents: 900, station: 'BAR' },
      { name: 'Sake', description: '120ml', priceCents: 1200, station: 'BAR' }
    ]
  },
  {
    name: 'Desserts',
    items: [
      { name: 'Mochi', description: 'Two pieces', priceCents: 600, station: 'DESSERT' },
      { name: 'Matcha ice', description: 'One scoop', priceCents: 700, station: 'DESSERT' }
    ]
  }
]

async function menuFor(branchId: string) {
  for (const [index, category] of MENU.entries()) {
    const created = await prisma.menuCategory.create({
      data: { branchId, name: category.name, sortOrder: index }
    })
    for (const [itemIndex, item] of category.items.entries()) {
      await prisma.menuItem.create({
        data: { ...item, categoryId: created.id, sortOrder: itemIndex }
      })
    }
  }
}

async function tablesFor(
  branchId: string,
  floorPlanId: string,
  branchCode: string,
  tables: Array<{ label: string; zone: TableZone; shape: TableShape; seats: number; posX: number; posY: number; width: number; height: number }>
) {
  for (const table of tables) {
    const token = `${branchCode}-${table.label}`.toLowerCase().replace(/\s+/g, '-')
    await prisma.diningTable.create({
      data: {
        ...table,
        branchId,
        floorPlanId,
        qrTokens: { create: { branchId, token } }
      }
    })
  }
}

async function main() {
  const existing = await prisma.restaurantProfile.findFirst()
  if (existing) {
    console.log('Already seeded')
    return
  }

  await prisma.restaurantProfile.create({
    data: {
      name: 'Towns',
      legalName: 'Towns Diner',
      tagline: 'A quiet room. A fast check.',
      phone: '+1 415 555 0148',
      email: 'hello@towns.test',
      address: '18 Cedar Lane'
    }
  })

  const shibuya = await prisma.branch.create({
    data: {
      name: "Town's Diner",
      code: 'TOWNS',
      address: 'Kolonia, Pohnpei',
      city: 'Kolonia Pohnpei FSM',
      phone: '+1 415 555 0148',
      timezone: 'Pacific/Pohnpei',
        settings: {
          create: {
            currency: 'USD',
          serviceChargeBps: 0,
          serviceChargeLabel: 'Service',
          receiptHeader: 'Towns',
          receiptFooter: 'Thank you'
        }
      },
      floorPlans: { create: { name: 'Main floor', isDefault: true } },
      printers: {
        create: [
          { name: 'Receipt', kind: 'RECEIPT', connection: 'NETWORK', address: '', paperWidth: 80, isDefault: true },
          { name: 'Kitchen', kind: 'KITCHEN', connection: 'NETWORK', address: '', paperWidth: 80, isDefault: true },
          { name: 'Sushi', kind: 'SUSHI', connection: 'NETWORK', address: '', paperWidth: 80, isDefault: true },
          { name: 'Bar', kind: 'BAR', connection: 'NETWORK', address: '', paperWidth: 80, isDefault: true },
          { name: 'Dessert', kind: 'DESSERT', connection: 'NETWORK', address: '', paperWidth: 80, isDefault: true }
        ]
      }
    },
    include: { floorPlans: true }
  })

  const ginza = await prisma.branch.create({
    data: {
      name: 'Ginza',
      code: 'GINZA',
      address: '4 Mercer Street',
      city: 'San Francisco',
      phone: '+1 415 555 0190',
      timezone: 'America/Los_Angeles',
      settings: { create: { currency: 'USD', receiptHeader: 'Towns · Ginza' } },
      floorPlans: { create: { name: 'Main floor', isDefault: true } },
      printers: { create: [{ name: 'Receipt', kind: 'RECEIPT', isDefault: true, paperWidth: 80 }] }
    },
    include: { floorPlans: true }
  })

  const shibuyaFloor = shibuya.floorPlans[0]
  const ginzaFloor = ginza.floorPlans[0]
  if (!shibuyaFloor || !ginzaFloor) throw new Error('Floor missing')

  await tablesFor(shibuya.id, shibuyaFloor.id, 'shibuya', [
    { label: 'A1', zone: 'DINING', shape: 'SQUARE', seats: 2, posX: 6, posY: 10, width: 14, height: 18 },
    { label: 'A2', zone: 'DINING', shape: 'SQUARE', seats: 2, posX: 24, posY: 10, width: 14, height: 18 },
    { label: 'A3', zone: 'DINING', shape: 'SQUARE', seats: 4, posX: 42, posY: 10, width: 16, height: 18 },
    { label: 'A4', zone: 'DINING', shape: 'ROUND', seats: 4, posX: 6, posY: 38, width: 16, height: 20 },
    { label: 'A5', zone: 'DINING', shape: 'ROUND', seats: 4, posX: 26, posY: 38, width: 16, height: 20 },
    { label: 'A6', zone: 'DINING', shape: 'RECTANGLE', seats: 6, posX: 46, posY: 38, width: 20, height: 18 },
    { label: 'VIP 1', zone: 'VIP', shape: 'RECTANGLE', seats: 6, posX: 72, posY: 10, width: 22, height: 24 },
    { label: 'VIP 2', zone: 'VIP', shape: 'RECTANGLE', seats: 4, posX: 72, posY: 42, width: 22, height: 22 },
    { label: 'Bar 1', zone: 'BAR', shape: 'BAR', seats: 1, posX: 6, posY: 72, width: 28, height: 14 },
    { label: 'Bar 2', zone: 'BAR', shape: 'BAR', seats: 1, posX: 38, posY: 72, width: 28, height: 14 }
  ])

  await tablesFor(ginza.id, ginzaFloor.id, 'ginza', [
    { label: 'G1', zone: 'DINING', shape: 'SQUARE', seats: 2, posX: 10, posY: 16, width: 16, height: 20 },
    { label: 'G2', zone: 'DINING', shape: 'SQUARE', seats: 4, posX: 32, posY: 16, width: 16, height: 20 },
    { label: 'G3', zone: 'DINING', shape: 'ROUND', seats: 4, posX: 54, posY: 16, width: 16, height: 20 },
    { label: 'Bar 1', zone: 'BAR', shape: 'BAR', seats: 1, posX: 10, posY: 60, width: 40, height: 14 }
  ])

  await menuFor(shibuya.id)
  await menuFor(ginza.id)

  const staff: Array<{ email: string; password: string; pin: string; firstName: string; lastName: string; role: 'SUPER_ADMIN' | 'ADMIN' | 'RESTAURANT_MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN_STAFF' | 'BARTENDER' | 'INVENTORY_STAFF'; branchId: string | null }> = [
    { email: 'super@towns.test', password: 'Towns#Super1', pin: '9001', firstName: 'Aya', lastName: 'Mori', role: 'SUPER_ADMIN', branchId: null },
    { email: 'admin@towns.test', password: 'Towns#Admin1', pin: '9002', firstName: 'Ken', lastName: 'Ito', role: 'ADMIN', branchId: null },
    { email: 'manager@towns.test', password: 'Towns#Manager1', pin: '1001', firstName: 'Hana', lastName: 'Sato', role: 'RESTAURANT_MANAGER', branchId: shibuya.id },
    { email: 'cashier@towns.test', password: 'Towns#Cash1', pin: '2001', firstName: 'Jun', lastName: 'Abe', role: 'CASHIER', branchId: shibuya.id },
    { email: 'waiter@towns.test', password: 'Towns#Waiter1', pin: '3001', firstName: 'Mio', lastName: 'Kato', role: 'WAITER', branchId: shibuya.id },
    { email: 'kitchen@towns.test', password: 'Towns#Kitchen1', pin: '4001', firstName: 'Ren', lastName: 'Fujita', role: 'KITCHEN_STAFF', branchId: shibuya.id },
    { email: 'bar@towns.test', password: 'Towns#Bar1', pin: '5001', firstName: 'Sora', lastName: 'Hayashi', role: 'BARTENDER', branchId: shibuya.id },
    { email: 'inventory@towns.test', password: 'Towns#Stock1', pin: '6001', firstName: 'Yui', lastName: 'Nakamura', role: 'INVENTORY_STAFF', branchId: shibuya.id }
  ]

  const cashier = { id: '' }
  for (const person of staff) {
    const user = await prisma.user.create({
      data: {
        email: person.email,
        passwordHash: await bcrypt.hash(person.password, 10),
        pinLookup: pinLookup(person.pin),
        firstName: person.firstName,
        lastName: person.lastName,
        role: person.role,
        branchId: person.branchId
      }
    })
    if (person.role === 'CASHIER') cashier.id = user.id
  }

  const tableA1 = await prisma.diningTable.findFirstOrThrow({ where: { branchId: shibuya.id, label: 'A1' } })
  const vip2 = await prisma.diningTable.findFirstOrThrow({ where: { branchId: shibuya.id, label: 'VIP 2' } })
  const tableA3 = await prisma.diningTable.findFirstOrThrow({ where: { branchId: shibuya.id, label: 'A3' } })
  const ramen = await prisma.menuItem.findFirstOrThrow({
    where: { name: 'Shoyu ramen', category: { branchId: shibuya.id } }
  })
  const tea = await prisma.menuItem.findFirstOrThrow({
    where: { name: 'Green tea', category: { branchId: shibuya.id } }
  })
  const settings = await prisma.branchSettings.findUniqueOrThrow({ where: { branchId: shibuya.id } })
  const priced = priceItems(
    [
      { unitPriceCents: ramen.priceCents, quantity: 1, voided: false },
      { unitPriceCents: tea.priceCents, quantity: 1, voided: false }
    ],
    settings
  )

  await prisma.order.create({
    data: {
      id: '11111111-1111-4111-8111-111111111111',
      branchId: shibuya.id,
      type: 'DINE_IN',
      status: 'SENT',
      progress: 'ORDERED',
      source: 'POS',
      tableId: tableA1.id,
      serverId: cashier.id,
      guestCount: 2,
      currency: 'USD',
      ...priced,
      items: {
        create: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            menuItemId: ramen.id,
            name: ramen.name,
            unitPriceCents: ramen.priceCents,
            quantity: 1,
            station: ramen.station,
            sentAt: new Date()
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            menuItemId: tea.id,
            name: tea.name,
            unitPriceCents: tea.priceCents,
            quantity: 1,
            station: tea.station,
            sentAt: new Date()
          }
        ]
      }
    }
  })
  await prisma.diningTable.update({ where: { id: tableA1.id }, data: { status: 'OCCUPIED' } })

  await prisma.reservation.create({
    data: {
      branchId: shibuya.id,
      tableId: vip2.id,
      type: 'ADVANCE',
      status: 'CONFIRMED',
      guestName: 'Aiko Mori',
      guestPhone: '+1 415 555 0172',
      guestCount: 2,
      reservedAt: new Date(Date.now() + 90 * 60 * 1000),
      depositAmountCents: 2000,
      depositPaid: true,
      notes: 'Window seat if the room allows'
    }
  })
  await prisma.diningTable.update({ where: { id: vip2.id }, data: { status: 'RESERVED' } })

  await prisma.reservation.create({
    data: {
      branchId: shibuya.id,
      tableId: tableA3.id,
      type: 'ADVANCE',
      status: 'CONFIRMED',
      guestName: 'Kenji Sato',
      guestPhone: '+1 415 555 0114',
      guestCount: 4,
      reservedAt: new Date(Date.now() + 26 * 60 * 60 * 1000),
      notes: ''
    }
  })

  // Seed modifier groups and options
  await seedModifiers()

  console.log('Seeded Towns. Cashier PIN 2001. Manager PIN 1001.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
