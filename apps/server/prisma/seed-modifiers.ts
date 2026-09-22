import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

export async function seedModifiers() {
  console.log('🔧 Seeding modifier groups and options...')

  // Get the first branch (assuming it exists from main seed)
  const branch = await prisma.branch.findFirst()
  if (!branch) {
    console.log('No branch found - please run main seed first')
    return
  }

  console.log(`Creating modifiers for branch: ${branch.name}`)

  // 1. Burger Add-ons (Multi-select, Optional)
  const burgerAddons = await prisma.modifierGroup.create({
    data: {
      id: randomUUID(),
      branchId: branch.id,
      name: 'Burger Add-ons',
      description: 'Extra toppings and ingredients for burgers',
      isRequired: false,
      minSelections: 0,
      maxSelections: 5,
      isMultipleSelect: true,
      sortOrder: 0,
      isActive: true
    }
  })

  await prisma.modifierOption.createMany({
    data: [
      {
        id: randomUUID(),
        modifierGroupId: burgerAddons.id,
        name: 'Extra Cheese',
        description: 'Add a slice of cheese',
        priceCents: 100, // $1.00
        sortOrder: 0,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: burgerAddons.id,
        name: 'Bacon',
        description: 'Crispy bacon strips',
        priceCents: 200, // $2.00
        sortOrder: 1,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: burgerAddons.id,
        name: 'Extra Patty',
        description: 'Double up with an extra beef patty',
        priceCents: 400, // $4.00
        sortOrder: 2,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: burgerAddons.id,
        name: 'Avocado',
        description: 'Fresh sliced avocado',
        priceCents: 150, // $1.50
        sortOrder: 3,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: burgerAddons.id,
        name: 'Mushrooms',
        description: 'Sautéed mushrooms',
        priceCents: 100, // $1.00
        sortOrder: 4,
        isActive: true
      }
    ]
  })

  // 2. Burger Removals (Multi-select, Optional, Free)
  const burgerRemovals = await prisma.modifierGroup.create({
    data: {
      id: randomUUID(),
      branchId: branch.id,
      name: 'Burger Removals',
      description: 'Remove ingredients you don\'t want',
      isRequired: false,
      minSelections: 0,
      maxSelections: 10,
      isMultipleSelect: true,
      sortOrder: 1,
      isActive: true
    }
  })

  await prisma.modifierOption.createMany({
    data: [
      {
        id: randomUUID(),
        modifierGroupId: burgerRemovals.id,
        name: 'No Onion',
        description: 'Remove onions',
        priceCents: 0, // Free
        sortOrder: 0,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: burgerRemovals.id,
        name: 'No Tomato',
        description: 'Remove tomatoes',
        priceCents: 0, // Free
        sortOrder: 1,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: burgerRemovals.id,
        name: 'No Lettuce',
        description: 'Remove lettuce',
        priceCents: 0, // Free
        sortOrder: 2,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: burgerRemovals.id,
        name: 'No Pickles',
        description: 'Remove pickles',
        priceCents: 0, // Free
        sortOrder: 3,
        isActive: true
      }
    ]
  })

  // 3. Cooking Temperature (Single-select, Optional)
  const cookingTemp = await prisma.modifierGroup.create({
    data: {
      id: randomUUID(),
      branchId: branch.id,
      name: 'Cooking Temperature',
      description: 'How would you like your burger cooked?',
      isRequired: false,
      minSelections: 0,
      maxSelections: 1,
      isMultipleSelect: false,
      sortOrder: 2,
      isActive: true
    }
  })

  await prisma.modifierOption.createMany({
    data: [
      {
        id: randomUUID(),
        modifierGroupId: cookingTemp.id,
        name: 'Rare',
        description: 'Cool red center',
        priceCents: 0,
        sortOrder: 0,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: cookingTemp.id,
        name: 'Medium Rare',
        description: 'Warm red center',
        priceCents: 0,
        sortOrder: 1,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: cookingTemp.id,
        name: 'Medium',
        description: 'Pink center',
        priceCents: 0,
        sortOrder: 2,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: cookingTemp.id,
        name: 'Medium Well',
        description: 'Slightly pink center',
        priceCents: 0,
        sortOrder: 3,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: cookingTemp.id,
        name: 'Well Done',
        description: 'No pink, fully cooked',
        priceCents: 0,
        sortOrder: 4,
        isActive: true
      }
    ]
  })

  // 4. Drink Size (Single-select, Required)
  const drinkSize = await prisma.modifierGroup.create({
    data: {
      id: randomUUID(),
      branchId: branch.id,
      name: 'Drink Size',
      description: 'Choose your drink size',
      isRequired: true,
      minSelections: 1,
      maxSelections: 1,
      isMultipleSelect: false,
      sortOrder: 3,
      isActive: true
    }
  })

  await prisma.modifierOption.createMany({
    data: [
      {
        id: randomUUID(),
        modifierGroupId: drinkSize.id,
        name: 'Small',
        description: '12oz cup',
        priceCents: 0, // Base price
        sortOrder: 0,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: drinkSize.id,
        name: 'Medium',
        description: '16oz cup',
        priceCents: 100, // +$1.00
        sortOrder: 1,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: drinkSize.id,
        name: 'Large',
        description: '20oz cup',
        priceCents: 200, // +$2.00
        sortOrder: 2,
        isActive: true
      }
    ]
  })

  // 5. Pizza Toppings (Multi-select, Optional)
  const pizzaToppings = await prisma.modifierGroup.create({
    data: {
      id: randomUUID(),
      branchId: branch.id,
      name: 'Pizza Toppings',
      description: 'Add delicious toppings to your pizza',
      isRequired: false,
      minSelections: 0,
      maxSelections: 8,
      isMultipleSelect: true,
      sortOrder: 4,
      isActive: true
    }
  })

  await prisma.modifierOption.createMany({
    data: [
      {
        id: randomUUID(),
        modifierGroupId: pizzaToppings.id,
        name: 'Pepperoni',
        description: 'Classic pepperoni slices',
        priceCents: 200, // $2.00
        sortOrder: 0,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: pizzaToppings.id,
        name: 'Mushrooms',
        description: 'Fresh button mushrooms',
        priceCents: 150, // $1.50
        sortOrder: 1,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: pizzaToppings.id,
        name: 'Extra Cheese',
        description: 'Double the mozzarella',
        priceCents: 200, // $2.00
        sortOrder: 2,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: pizzaToppings.id,
        name: 'Bell Peppers',
        description: 'Colorful bell pepper strips',
        priceCents: 150, // $1.50
        sortOrder: 3,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: pizzaToppings.id,
        name: 'Italian Sausage',
        description: 'Seasoned Italian sausage',
        priceCents: 250, // $2.50
        sortOrder: 4,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: pizzaToppings.id,
        name: 'Pineapple',
        description: 'Sweet pineapple chunks',
        priceCents: 150, // $1.50
        sortOrder: 5,
        isActive: true
      }
    ]
  })

  // 6. Spice Level (Single-select, Optional)
  const spiceLevel = await prisma.modifierGroup.create({
    data: {
      id: randomUUID(),
      branchId: branch.id,
      name: 'Spice Level',
      description: 'How spicy do you want it?',
      isRequired: false,
      minSelections: 0,
      maxSelections: 1,
      isMultipleSelect: false,
      sortOrder: 5,
      isActive: true
    }
  })

  await prisma.modifierOption.createMany({
    data: [
      {
        id: randomUUID(),
        modifierGroupId: spiceLevel.id,
        name: 'Mild',
        description: 'Just a little kick',
        priceCents: 0,
        sortOrder: 0,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: spiceLevel.id,
        name: 'Medium',
        description: 'Moderate heat level',
        priceCents: 0,
        sortOrder: 1,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: spiceLevel.id,
        name: 'Hot',
        description: 'Bring the heat!',
        priceCents: 0,
        sortOrder: 2,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: spiceLevel.id,
        name: 'Extra Hot',
        description: 'Only for the brave',
        priceCents: 50, // $0.50 for extra hot sauce
        sortOrder: 3,
        isActive: true
      }
    ]
  })

  // 7. Side Upgrades (Single-select, Optional)
  const sideUpgrades = await prisma.modifierGroup.create({
    data: {
      id: randomUUID(),
      branchId: branch.id,
      name: 'Side Upgrades',
      description: 'Upgrade your fries to something special',
      isRequired: false,
      minSelections: 0,
      maxSelections: 1,
      isMultipleSelect: false,
      sortOrder: 6,
      isActive: true
    }
  })

  await prisma.modifierOption.createMany({
    data: [
      {
        id: randomUUID(),
        modifierGroupId: sideUpgrades.id,
        name: 'Sweet Potato Fries',
        description: 'Crispy sweet potato fries',
        priceCents: 150, // +$1.50
        sortOrder: 0,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: sideUpgrades.id,
        name: 'Onion Rings',
        description: 'Golden battered onion rings',
        priceCents: 200, // +$2.00
        sortOrder: 1,
        isActive: true
      },
      {
        id: randomUUID(),
        modifierGroupId: sideUpgrades.id,
        name: 'Side Salad',
        description: 'Fresh mixed greens',
        priceCents: 250, // +$2.50
        sortOrder: 2,
        isActive: true
      }
    ]
  })

  console.log('✅ Created modifier groups:')
  console.log(`   - ${burgerAddons.name} (${5} options)`)
  console.log(`   - ${burgerRemovals.name} (${4} options)`)
  console.log(`   - ${cookingTemp.name} (${5} options)`)
  console.log(`   - ${drinkSize.name} (${3} options)`)
  console.log(`   - ${pizzaToppings.name} (${6} options)`)
  console.log(`   - ${spiceLevel.name} (${4} options)`)
  console.log(`   - ${sideUpgrades.name} (${3} options)`)

  // Now let's assign some modifiers to existing menu items
  console.log('🔗 Assigning modifiers to menu items...')

  // Get some menu items to assign modifiers to
  const menuItems = await prisma.menuItem.findMany({
    where: { category: { branchId: branch.id } },
    include: { category: true }
  })

  if (menuItems.length === 0) {
    console.log('No menu items found - please run main seed first')
    return
  }

  // Assign modifiers based on item names (best effort)
  for (const item of menuItems) {
    const itemName = item.name.toLowerCase()
    const assignments: string[] = []

    // Burgers get burger-related modifiers
    if (itemName.includes('burger') || itemName.includes('beef')) {
      assignments.push(burgerAddons.id, burgerRemovals.id, cookingTemp.id, sideUpgrades.id)
    }

    // Drinks get size modifiers
    if (itemName.includes('drink') || itemName.includes('soda') || itemName.includes('tea') || itemName.includes('coffee')) {
      assignments.push(drinkSize.id)
    }

    // Pizza gets pizza modifiers
    if (itemName.includes('pizza')) {
      assignments.push(pizzaToppings.id, spiceLevel.id)
    }

    // Ramen gets spice level
    if (itemName.includes('ramen') || itemName.includes('noodle')) {
      assignments.push(spiceLevel.id)
    }

    // Tempura gets spice level (for dipping sauce)
    if (itemName.includes('tempura') || itemName.includes('fried')) {
      assignments.push(spiceLevel.id)
    }

    // Create assignments
    for (const groupId of assignments) {
      try {
        await prisma.menuItemModifierGroup.create({
          data: {
            id: randomUUID(),
            menuItemId: item.id,
            modifierGroupId: groupId
          }
        })
      } catch (error) {
        // Skip if already exists
      }
    }

    if (assignments.length > 0) {
      console.log(`   - ${item.name}: assigned ${assignments.length} modifier groups`)
    }
  }

  console.log('🎉 Modifier seeding completed!')
}

// Run if called directly
if (require.main === module) {
  seedModifiers()
    .then(() => {
      console.log('✅ Modifier seed completed')
      process.exit(0)
    })
    .catch((e) => {
      console.error('❌ Modifier seed failed:', e)
      process.exit(1)
    })
    .finally(() => {
      void prisma.$disconnect()
    })
}