#!/usr/bin/env node

/**
 * Towns Diner POS - Modifier System Seeding via API
 * 
 * This script populates your system with realistic modifier groups and options
 * using the REST API endpoints. Make sure your server is running first!
 * 
 * Usage:
 *   1. Start your server: npm run dev:server
 *   2. Login to get an auth token
 *   3. Update the AUTH_TOKEN and BRANCH_ID below
 *   4. Run: node seed-modifiers-api.js
 */

// Configuration - UPDATE THESE VALUES
const API_BASE = 'http://localhost:4000/api'
const AUTH_TOKEN = 'YOUR_AUTH_TOKEN_HERE' // Get this by logging in
const BRANCH_ID = 'YOUR_BRANCH_ID_HERE'   // Get this from /api/branches

// Sample modifier data
const MODIFIER_GROUPS = [
  {
    name: 'Burger Add-ons',
    description: 'Extra toppings and ingredients for burgers',
    isRequired: false,
    minSelections: 0,
    maxSelections: 5,
    isMultipleSelect: true,
    isActive: true,
    options: [
      { name: 'Extra Cheese', description: 'Add a slice of cheese', priceCents: 100 },
      { name: 'Bacon', description: 'Crispy bacon strips', priceCents: 200 },
      { name: 'Extra Patty', description: 'Double up with an extra beef patty', priceCents: 400 },
      { name: 'Avocado', description: 'Fresh sliced avocado', priceCents: 150 },
      { name: 'Mushrooms', description: 'Sautéed mushrooms', priceCents: 100 }
    ]
  },
  {
    name: 'Burger Removals',
    description: 'Remove ingredients you don\'t want',
    isRequired: false,
    minSelections: 0,
    maxSelections: 10,
    isMultipleSelect: true,
    isActive: true,
    options: [
      { name: 'No Onion', description: 'Remove onions', priceCents: 0 },
      { name: 'No Tomato', description: 'Remove tomatoes', priceCents: 0 },
      { name: 'No Lettuce', description: 'Remove lettuce', priceCents: 0 },
      { name: 'No Pickles', description: 'Remove pickles', priceCents: 0 }
    ]
  },
  {
    name: 'Cooking Temperature',
    description: 'How would you like your burger cooked?',
    isRequired: false,
    minSelections: 0,
    maxSelections: 1,
    isMultipleSelect: false,
    isActive: true,
    options: [
      { name: 'Rare', description: 'Cool red center', priceCents: 0 },
      { name: 'Medium Rare', description: 'Warm red center', priceCents: 0 },
      { name: 'Medium', description: 'Pink center', priceCents: 0 },
      { name: 'Medium Well', description: 'Slightly pink center', priceCents: 0 },
      { name: 'Well Done', description: 'No pink, fully cooked', priceCents: 0 }
    ]
  },
  {
    name: 'Drink Size',
    description: 'Choose your drink size',
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    isMultipleSelect: false,
    isActive: true,
    options: [
      { name: 'Small', description: '12oz cup', priceCents: 0 },
      { name: 'Medium', description: '16oz cup', priceCents: 100 },
      { name: 'Large', description: '20oz cup', priceCents: 200 }
    ]
  },
  {
    name: 'Pizza Toppings',
    description: 'Add delicious toppings to your pizza',
    isRequired: false,
    minSelections: 0,
    maxSelections: 8,
    isMultipleSelect: true,
    isActive: true,
    options: [
      { name: 'Pepperoni', description: 'Classic pepperoni slices', priceCents: 200 },
      { name: 'Mushrooms', description: 'Fresh button mushrooms', priceCents: 150 },
      { name: 'Extra Cheese', description: 'Double the mozzarella', priceCents: 200 },
      { name: 'Bell Peppers', description: 'Colorful bell pepper strips', priceCents: 150 },
      { name: 'Italian Sausage', description: 'Seasoned Italian sausage', priceCents: 250 },
      { name: 'Pineapple', description: 'Sweet pineapple chunks', priceCents: 150 }
    ]
  },
  {
    name: 'Spice Level',
    description: 'How spicy do you want it?',
    isRequired: false,
    minSelections: 0,
    maxSelections: 1,
    isMultipleSelect: false,
    isActive: true,
    options: [
      { name: 'Mild', description: 'Just a little kick', priceCents: 0 },
      { name: 'Medium', description: 'Moderate heat level', priceCents: 0 },
      { name: 'Hot', description: 'Bring the heat!', priceCents: 0 },
      { name: 'Extra Hot', description: 'Only for the brave', priceCents: 50 }
    ]
  },
  {
    name: 'Side Upgrades',
    description: 'Upgrade your fries to something special',
    isRequired: false,
    minSelections: 0,
    maxSelections: 1,
    isMultipleSelect: false,
    isActive: true,
    options: [
      { name: 'Sweet Potato Fries', description: 'Crispy sweet potato fries', priceCents: 150 },
      { name: 'Onion Rings', description: 'Golden battered onion rings', priceCents: 200 },
      { name: 'Side Salad', description: 'Fresh mixed greens', priceCents: 250 }
    ]
  }
]

async function apiRequest(endpoint, method = 'GET', body = null) {
  const url = `${API_BASE}${endpoint}`
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`
    }
  }
  
  if (body) {
    options.body = JSON.stringify(body)
  }

  try {
    const response = await fetch(url, options)
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(`API Error: ${data.message || response.statusText}`)
    }
    
    return data.data
  } catch (error) {
    console.error(`Request failed: ${method} ${endpoint}`, error.message)
    throw error
  }
}

async function seedModifiers() {
  console.log('🔧 Starting modifier seeding via API...')
  
  // Validate configuration
  if (AUTH_TOKEN === 'YOUR_AUTH_TOKEN_HERE') {
    console.log('❌ Please update AUTH_TOKEN in the script')
    console.log('   1. Login to your POS system')
    console.log('   2. Get the Bearer token from browser dev tools')
    console.log('   3. Update AUTH_TOKEN in this script')
    return
  }
  
  if (BRANCH_ID === 'YOUR_BRANCH_ID_HERE') {
    console.log('❌ Please update BRANCH_ID in the script')
    console.log('   1. Get branch ID from GET /api/branches')
    console.log('   2. Update BRANCH_ID in this script')
    return
  }

  try {
    // Test connection
    console.log('🔍 Testing API connection...')
    await apiRequest('/auth/me')
    console.log('✅ API connection successful')

    const createdGroups = []

    // Create modifier groups and their options
    for (const groupData of MODIFIER_GROUPS) {
      console.log(`📝 Creating modifier group: ${groupData.name}`)
      
      // Create the group
      const { options, ...groupPayload } = groupData
      const groups = await apiRequest(`/branches/${BRANCH_ID}/modifiers`, 'POST', groupPayload)
      
      // Find the created group
      const createdGroup = groups.find(g => g.name === groupData.name)
      if (!createdGroup) {
        throw new Error(`Failed to create group: ${groupData.name}`)
      }
      
      createdGroups.push(createdGroup)
      console.log(`   ✅ Created group with ID: ${createdGroup.id}`)

      // Create options for this group
      for (const optionData of options) {
        console.log(`   📋 Creating option: ${optionData.name}`)
        
        const optionPayload = {
          modifierGroupId: createdGroup.id,
          ...optionData,
          isActive: true
        }
        
        await apiRequest(`/branches/${BRANCH_ID}/modifier-options`, 'POST', optionPayload)
        console.log(`      ✅ Created option: ${optionData.name} (+$${(optionData.priceCents / 100).toFixed(2)})`)
      }
      
      console.log(`   🎉 Completed group: ${groupData.name} (${options.length} options)`)
    }

    console.log('\n🎯 Modifier groups created successfully!')
    console.log(`   Total groups: ${createdGroups.length}`)
    console.log(`   Total options: ${MODIFIER_GROUPS.reduce((sum, g) => sum + g.options.length, 0)}`)

    // Now assign modifiers to menu items (best effort)
    console.log('\n🔗 Assigning modifiers to menu items...')
    
    try {
      // Get menu items
      const menuCategories = await apiRequest(`/branches/${BRANCH_ID}/menu/manage`)
      const allItems = menuCategories.flatMap(category => category.items)
      
      if (allItems.length === 0) {
        console.log('   ⚠️  No menu items found - please create some menu items first')
        return
      }

      let assignmentCount = 0
      
      for (const item of allItems) {
        const itemName = item.name.toLowerCase()
        const assignGroupIds = []

        // Assign based on item type
        if (itemName.includes('burger') || itemName.includes('beef')) {
          const burgerGroups = createdGroups.filter(g => 
            ['Burger Add-ons', 'Burger Removals', 'Cooking Temperature', 'Side Upgrades'].includes(g.name)
          )
          assignGroupIds.push(...burgerGroups.map(g => g.id))
        }

        if (itemName.includes('pizza')) {
          const pizzaGroups = createdGroups.filter(g => 
            ['Pizza Toppings', 'Spice Level'].includes(g.name)
          )
          assignGroupIds.push(...pizzaGroups.map(g => g.id))
        }

        if (itemName.includes('drink') || itemName.includes('soda') || itemName.includes('tea') || itemName.includes('coffee')) {
          const drinkGroups = createdGroups.filter(g => g.name === 'Drink Size')
          assignGroupIds.push(...drinkGroups.map(g => g.id))
        }

        if (itemName.includes('ramen') || itemName.includes('spicy') || itemName.includes('tempura')) {
          const spiceGroups = createdGroups.filter(g => g.name === 'Spice Level')
          assignGroupIds.push(...spiceGroups.map(g => g.id))
        }

        // Assign modifiers if any were selected
        if (assignGroupIds.length > 0) {
          try {
            await apiRequest(
              `/branches/${BRANCH_ID}/menu/items/${item.id}/modifiers`,
              'PUT',
              { modifierGroupIds: assignGroupIds }
            )
            console.log(`   ✅ ${item.name}: assigned ${assignGroupIds.length} modifier groups`)
            assignmentCount++
          } catch (error) {
            console.log(`   ⚠️  Failed to assign modifiers to ${item.name}: ${error.message}`)
          }
        }
      }
      
      console.log(`\n🎉 Assignment completed! ${assignmentCount} items now have modifiers`)
      
    } catch (error) {
      console.log(`   ⚠️  Could not assign modifiers to menu items: ${error.message}`)
    }

    console.log('\n🚀 Modifier seeding completed successfully!')
    console.log('\n🧪 How to test:')
    console.log('   1. Go to /modifiers to see the management interface')
    console.log('   2. Go to /orders and create a new order')
    console.log('   3. Select a menu item - modifier dialog should appear automatically!')
    console.log('   4. Choose modifiers and see real-time price calculation')

  } catch (error) {
    console.error('❌ Seeding failed:', error.message)
    console.log('\n🔧 Troubleshooting:')
    console.log('   1. Make sure your server is running (npm run dev:server)')
    console.log('   2. Verify AUTH_TOKEN is valid (login again if needed)')
    console.log('   3. Verify BRANCH_ID exists in your system')
    console.log('   4. Check server logs for detailed error messages')
  }
}

// Check if we have node-fetch available, otherwise provide instructions
async function main() {
  try {
    // Try to use native fetch (Node 18+) or require node-fetch
    if (typeof fetch === 'undefined') {
      try {
        const { default: fetch } = await import('node-fetch')
        global.fetch = fetch
      } catch (error) {
        console.log('❌ This script requires Node.js 18+ or the node-fetch package')
        console.log('   Install with: npm install node-fetch')
        console.log('   Or upgrade to Node.js 18+')
        return
      }
    }
    
    await seedModifiers()
  } catch (error) {
    console.error('❌ Script failed:', error.message)
  }
}

main()