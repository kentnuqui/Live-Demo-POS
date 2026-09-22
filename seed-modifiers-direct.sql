-- Towns Diner POS - Modifier System Demo Data
-- Run this SQL directly in your PostgreSQL database to seed modifier data

-- Get the branch ID (replace with your actual branch ID)
-- You can get this by running: SELECT id, name FROM branches;

-- For this script, we'll use a variable - replace 'YOUR_BRANCH_ID_HERE' with the actual UUID
-- Example: SET @branch_id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

-- 1. Burger Add-ons Group
INSERT INTO modifier_groups (id, branch_id, name, description, is_required, min_selections, max_selections, is_multiple_select, sort_order, is_active, created_at, updated_at) 
VALUES (
    gen_random_uuid(),
    (SELECT id FROM branches LIMIT 1), -- Gets first branch
    'Burger Add-ons',
    'Extra toppings and ingredients for burgers',
    false,
    0,
    5,
    true,
    0,
    true,
    NOW(),
    NOW()
);

-- Get the ID for Burger Add-ons group
WITH burger_addons AS (SELECT id FROM modifier_groups WHERE name = 'Burger Add-ons' ORDER BY created_at DESC LIMIT 1)
INSERT INTO modifier_options (id, modifier_group_id, name, description, price_cents, sort_order, is_active, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    burger_addons.id,
    option_name,
    option_desc,
    option_price,
    option_order,
    true,
    NOW(),
    NOW()
FROM burger_addons,
(VALUES 
    ('Extra Cheese', 'Add a slice of cheese', 100, 0),
    ('Bacon', 'Crispy bacon strips', 200, 1),
    ('Extra Patty', 'Double up with an extra beef patty', 400, 2),
    ('Avocado', 'Fresh sliced avocado', 150, 3),
    ('Mushrooms', 'Sautéed mushrooms', 100, 4)
) AS options(option_name, option_desc, option_price, option_order);

-- 2. Burger Removals Group (Free modifications)
INSERT INTO modifier_groups (id, branch_id, name, description, is_required, min_selections, max_selections, is_multiple_select, sort_order, is_active, created_at, updated_at) 
VALUES (
    gen_random_uuid(),
    (SELECT id FROM branches LIMIT 1),
    'Burger Removals',
    'Remove ingredients you don''t want',
    false,
    0,
    10,
    true,
    1,
    true,
    NOW(),
    NOW()
);

WITH burger_removals AS (SELECT id FROM modifier_groups WHERE name = 'Burger Removals' ORDER BY created_at DESC LIMIT 1)
INSERT INTO modifier_options (id, modifier_group_id, name, description, price_cents, sort_order, is_active, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    burger_removals.id,
    option_name,
    option_desc,
    0, -- All removals are free
    option_order,
    true,
    NOW(),
    NOW()
FROM burger_removals,
(VALUES 
    ('No Onion', 'Remove onions', 0),
    ('No Tomato', 'Remove tomatoes', 1),
    ('No Lettuce', 'Remove lettuce', 2),
    ('No Pickles', 'Remove pickles', 3)
) AS options(option_name, option_desc, option_order);

-- 3. Cooking Temperature Group (Free options)
INSERT INTO modifier_groups (id, branch_id, name, description, is_required, min_selections, max_selections, is_multiple_select, sort_order, is_active, created_at, updated_at) 
VALUES (
    gen_random_uuid(),
    (SELECT id FROM branches LIMIT 1),
    'Cooking Temperature',
    'How would you like your burger cooked?',
    false,
    0,
    1,
    false,
    2,
    true,
    NOW(),
    NOW()
);

WITH cooking_temp AS (SELECT id FROM modifier_groups WHERE name = 'Cooking Temperature' ORDER BY created_at DESC LIMIT 1)
INSERT INTO modifier_options (id, modifier_group_id, name, description, price_cents, sort_order, is_active, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    cooking_temp.id,
    option_name,
    option_desc,
    0, -- All cooking temperatures are free
    option_order,
    true,
    NOW(),
    NOW()
FROM cooking_temp,
(VALUES 
    ('Rare', 'Cool red center', 0),
    ('Medium Rare', 'Warm red center', 1),
    ('Medium', 'Pink center', 2),
    ('Medium Well', 'Slightly pink center', 3),
    ('Well Done', 'No pink, fully cooked', 4)
) AS options(option_name, option_desc, option_order);

-- 4. Drink Size Group (Required selection)
INSERT INTO modifier_groups (id, branch_id, name, description, is_required, min_selections, max_selections, is_multiple_select, sort_order, is_active, created_at, updated_at) 
VALUES (
    gen_random_uuid(),
    (SELECT id FROM branches LIMIT 1),
    'Drink Size',
    'Choose your drink size',
    true,
    1,
    1,
    false,
    3,
    true,
    NOW(),
    NOW()
);

WITH drink_size AS (SELECT id FROM modifier_groups WHERE name = 'Drink Size' ORDER BY created_at DESC LIMIT 1)
INSERT INTO modifier_options (id, modifier_group_id, name, description, price_cents, sort_order, is_active, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    drink_size.id,
    option_name,
    option_desc,
    option_price,
    option_order,
    true,
    NOW(),
    NOW()
FROM drink_size,
(VALUES 
    ('Small', '12oz cup', 0, 0),
    ('Medium', '16oz cup', 100, 1),
    ('Large', '20oz cup', 200, 2)
) AS options(option_name, option_desc, option_price, option_order);

-- 5. Pizza Toppings Group
INSERT INTO modifier_groups (id, branch_id, name, description, is_required, min_selections, max_selections, is_multiple_select, sort_order, is_active, created_at, updated_at) 
VALUES (
    gen_random_uuid(),
    (SELECT id FROM branches LIMIT 1),
    'Pizza Toppings',
    'Add delicious toppings to your pizza',
    false,
    0,
    8,
    true,
    4,
    true,
    NOW(),
    NOW()
);

WITH pizza_toppings AS (SELECT id FROM modifier_groups WHERE name = 'Pizza Toppings' ORDER BY created_at DESC LIMIT 1)
INSERT INTO modifier_options (id, modifier_group_id, name, description, price_cents, sort_order, is_active, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    pizza_toppings.id,
    option_name,
    option_desc,
    option_price,
    option_order,
    true,
    NOW(),
    NOW()
FROM pizza_toppings,
(VALUES 
    ('Pepperoni', 'Classic pepperoni slices', 200, 0),
    ('Mushrooms', 'Fresh button mushrooms', 150, 1),
    ('Extra Cheese', 'Double the mozzarella', 200, 2),
    ('Bell Peppers', 'Colorful bell pepper strips', 150, 3),
    ('Italian Sausage', 'Seasoned Italian sausage', 250, 4),
    ('Pineapple', 'Sweet pineapple chunks', 150, 5)
) AS options(option_name, option_desc, option_price, option_order);

-- 6. Spice Level Group
INSERT INTO modifier_groups (id, branch_id, name, description, is_required, min_selections, max_selections, is_multiple_select, sort_order, is_active, created_at, updated_at) 
VALUES (
    gen_random_uuid(),
    (SELECT id FROM branches LIMIT 1),
    'Spice Level',
    'How spicy do you want it?',
    false,
    0,
    1,
    false,
    5,
    true,
    NOW(),
    NOW()
);

WITH spice_level AS (SELECT id FROM modifier_groups WHERE name = 'Spice Level' ORDER BY created_at DESC LIMIT 1)
INSERT INTO modifier_options (id, modifier_group_id, name, description, price_cents, sort_order, is_active, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    spice_level.id,
    option_name,
    option_desc,
    option_price,
    option_order,
    true,
    NOW(),
    NOW()
FROM spice_level,
(VALUES 
    ('Mild', 'Just a little kick', 0, 0),
    ('Medium', 'Moderate heat level', 0, 1),
    ('Hot', 'Bring the heat!', 0, 2),
    ('Extra Hot', 'Only for the brave', 50, 3)
) AS options(option_name, option_desc, option_price, option_order);

-- 7. Side Upgrades Group
INSERT INTO modifier_groups (id, branch_id, name, description, is_required, min_selections, max_selections, is_multiple_select, sort_order, is_active, created_at, updated_at) 
VALUES (
    gen_random_uuid(),
    (SELECT id FROM branches LIMIT 1),
    'Side Upgrades',
    'Upgrade your fries to something special',
    false,
    0,
    1,
    false,
    6,
    true,
    NOW(),
    NOW()
);

WITH side_upgrades AS (SELECT id FROM modifier_groups WHERE name = 'Side Upgrades' ORDER BY created_at DESC LIMIT 1)
INSERT INTO modifier_options (id, modifier_group_id, name, description, price_cents, sort_order, is_active, created_at, updated_at)
SELECT 
    gen_random_uuid(),
    side_upgrades.id,
    option_name,
    option_desc,
    option_price,
    option_order,
    true,
    NOW(),
    NOW()
FROM side_upgrades,
(VALUES 
    ('Sweet Potato Fries', 'Crispy sweet potato fries', 150, 0),
    ('Onion Rings', 'Golden battered onion rings', 200, 1),
    ('Side Salad', 'Fresh mixed greens', 250, 2)
) AS options(option_name, option_desc, option_price, option_order);

-- Show results
SELECT 
    mg.name as group_name,
    COUNT(mo.id) as option_count,
    mg.is_required,
    mg.is_multiple_select,
    mg.min_selections,
    mg.max_selections
FROM modifier_groups mg
LEFT JOIN modifier_options mo ON mg.id = mo.modifier_group_id
GROUP BY mg.id, mg.name, mg.is_required, mg.is_multiple_select, mg.min_selections, mg.max_selections
ORDER BY mg.sort_order;

-- Sample assignment of modifiers to menu items
-- This will assign burger modifiers to any item containing 'burger' in the name
-- Adjust the WHERE clauses based on your actual menu items

-- Burger items get burger-related modifiers
INSERT INTO menu_item_modifier_groups (id, menu_item_id, modifier_group_id, created_at)
SELECT 
    gen_random_uuid(),
    mi.id,
    mg.id,
    NOW()
FROM menu_items mi
CROSS JOIN modifier_groups mg
WHERE LOWER(mi.name) LIKE '%burger%'
  AND mg.name IN ('Burger Add-ons', 'Burger Removals', 'Cooking Temperature', 'Side Upgrades')
ON CONFLICT DO NOTHING;

-- Pizza items get pizza modifiers
INSERT INTO menu_item_modifier_groups (id, menu_item_id, modifier_group_id, created_at)
SELECT 
    gen_random_uuid(),
    mi.id,
    mg.id,
    NOW()
FROM menu_items mi
CROSS JOIN modifier_groups mg
WHERE LOWER(mi.name) LIKE '%pizza%'
  AND mg.name IN ('Pizza Toppings', 'Spice Level')
ON CONFLICT DO NOTHING;

-- Drink items get size modifiers
INSERT INTO menu_item_modifier_groups (id, menu_item_id, modifier_group_id, created_at)
SELECT 
    gen_random_uuid(),
    mi.id,
    mg.id,
    NOW()
FROM menu_items mi
CROSS JOIN modifier_groups mg
WHERE (LOWER(mi.name) LIKE '%drink%' OR LOWER(mi.name) LIKE '%soda%' OR LOWER(mi.name) LIKE '%tea%' OR LOWER(mi.name) LIKE '%coffee%')
  AND mg.name = 'Drink Size'
ON CONFLICT DO NOTHING;

-- Ramen and spicy items get spice level
INSERT INTO menu_item_modifier_groups (id, menu_item_id, modifier_group_id, created_at)
SELECT 
    gen_random_uuid(),
    mi.id,
    mg.id,
    NOW()
FROM menu_items mi
CROSS JOIN modifier_groups mg
WHERE (LOWER(mi.name) LIKE '%ramen%' OR LOWER(mi.name) LIKE '%spicy%' OR LOWER(mi.name) LIKE '%tempura%')
  AND mg.name = 'Spice Level'
ON CONFLICT DO NOTHING;

-- Show final results
SELECT 
    'Modifier System Successfully Seeded!' as status,
    COUNT(DISTINCT mg.id) as total_groups,
    COUNT(mo.id) as total_options,
    COUNT(DISTINCT mimg.menu_item_id) as items_with_modifiers
FROM modifier_groups mg
LEFT JOIN modifier_options mo ON mg.id = mo.modifier_group_id  
LEFT JOIN menu_item_modifier_groups mimg ON mg.id = mimg.modifier_group_id;