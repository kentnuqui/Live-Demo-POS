export const USER_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'RESTAURANT_MANAGER',
  'CASHIER',
  'WAITER',
  'KITCHEN_STAFF',
  'BARTENDER',
  'INVENTORY_STAFF'
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'BILLING'] as const
export type TableStatus = (typeof TABLE_STATUSES)[number]

export const TABLE_SHAPES = ['SQUARE', 'ROUND', 'RECTANGLE', 'BAR'] as const
export type TableShape = (typeof TABLE_SHAPES)[number]

export const TABLE_ZONES = ['DINING', 'VIP', 'BAR', 'PATIO'] as const
export type TableZone = (typeof TABLE_ZONES)[number]

export const RESERVATION_TYPES = ['WALK_IN', 'ADVANCE'] as const
export type ReservationType = (typeof RESERVATION_TYPES)[number]

export const RESERVATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'SEATED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW'
] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export const ORDER_TYPES = ['DINE_IN', 'TAKEOUT', 'DELIVERY', 'ONLINE', 'QR'] as const
export type OrderType = (typeof ORDER_TYPES)[number]

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  DINE_IN: 'Dine in',
  TAKEOUT: 'Take out',
  DELIVERY: 'Delivery',
  ONLINE: 'Online',
  QR: 'QR'
}

export const ORDER_STATUSES = [
  'OPEN',
  'SENT',
  'PREPARING',
  'READY',
  'SERVED',
  'BILLING',
  'COMPLETED',
  'CANCELLED'
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const DINING_PROGRESS = ['SEATED', 'ORDERED', 'PREPARING', 'SERVED', 'BILLING', 'COMPLETED'] as const
export type DiningProgress = (typeof DINING_PROGRESS)[number]

export const ORDER_SOURCES = ['POS', 'QR', 'ONLINE'] as const
export type OrderSource = (typeof ORDER_SOURCES)[number]

export const DISCOUNT_KINDS = ['NONE', 'PERCENT', 'AMOUNT'] as const
export type DiscountKind = (typeof DISCOUNT_KINDS)[number]

export const PAYMENT_METHODS = ['CASH', 'CARD', 'OTHER'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  OTHER: 'Other'
}

export const MENU_STATIONS = ['KITCHEN', 'SUSHI', 'BAR', 'DESSERT'] as const
export type MenuStation = (typeof MENU_STATIONS)[number]

export const PRINTER_KINDS = ['RECEIPT', 'KITCHEN', 'BAR', 'SUSHI', 'DESSERT'] as const
export type PrinterKind = (typeof PRINTER_KINDS)[number]

export const PRINTER_CONNECTIONS = ['NETWORK', 'USB', 'BLUETOOTH'] as const
export type PrinterConnection = (typeof PRINTER_CONNECTIONS)[number]

export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  'OPEN',
  'SENT',
  'PREPARING',
  'READY',
  'SERVED',
  'BILLING'
]

/** Higher rank means a later point in service. Used so sync never rewinds a check. */
export const ORDER_STATUS_RANK: Record<OrderStatus, number> = {
  OPEN: 0,
  SENT: 1,
  PREPARING: 2,
  READY: 3,
  SERVED: 4,
  BILLING: 5,
  COMPLETED: 6,
  CANCELLED: 7
}

export const ROLE_RANK: Record<UserRole, number> = {
  SUPER_ADMIN: 100,
  ADMIN: 80,
  RESTAURANT_MANAGER: 60,
  CASHIER: 40,
  WAITER: 40,
  KITCHEN_STAFF: 30,
  BARTENDER: 30,
  INVENTORY_STAFF: 30
}

export const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  RESTAURANT_MANAGER: 'Restaurant Manager',
  CASHIER: 'Cashier',
  WAITER: 'Waiter',
  KITCHEN_STAFF: 'Kitchen Staff',
  BARTENDER: 'Bartender',
  INVENTORY_STAFF: 'Inventory Staff'
}
