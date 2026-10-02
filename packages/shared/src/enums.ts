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

/** Pass state for the kitchen display. Separate from check and payment status. */
export const KITCHEN_STATUSES = ['NEW', 'PREPARING', 'READY', 'COMPLETED'] as const
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number]

/** One firing of a check. Later additions keep the same order number. */
export const KITCHEN_SUBMISSION_KINDS = ['INITIAL', 'ADDITION'] as const
export type KitchenSubmissionKind = (typeof KITCHEN_SUBMISSION_KINDS)[number]

/** The only forward step from each kitchen state. Completed tickets leave the active pass. */
export const KITCHEN_STATUS_STEP: Record<KitchenStatus, KitchenStatus | null> = {
  NEW: 'PREPARING',
  PREPARING: 'READY',
  READY: 'COMPLETED',
  COMPLETED: null
}

/**
 * What the floor should show while a ticket is on the pass.
 * Payment status stays on the check. This only describes service.
 */
export const SERVICE_STATUSES = ['PREPARING', 'READY_TO_SERVE'] as const
export type ServiceStatus = (typeof SERVICE_STATUSES)[number]

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  PREPARING: 'Preparing',
  READY_TO_SERVE: 'Ready to serve'
}

export const DINING_PROGRESS = ['SEATED', 'ORDERED', 'PREPARING', 'SERVED', 'BILLING', 'COMPLETED'] as const
export type DiningProgress = (typeof DINING_PROGRESS)[number]

export const DINING_PROGRESS_LABEL: Record<DiningProgress, string> = {
  SEATED: 'Seated',
  ORDERED: 'Ordered',
  PREPARING: 'Preparing',
  SERVED: 'Served',
  BILLING: 'Billing',
  COMPLETED: 'Closed'
}

/**
 * Floor label for one check.
 * A finished pass is "Ready to serve". A closed or cancelled check keeps its own label.
 */
export function orderServiceLabel(order: {
  status: OrderStatus
  progress: DiningProgress
  serviceStatus?: ServiceStatus | null
}): string {
  if (order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && order.serviceStatus) {
    return SERVICE_STATUS_LABEL[order.serviceStatus]
  }
  return DINING_PROGRESS_LABEL[order.progress]
}

/** Persisted floor state for a kitchen step. New tickets keep the check's existing progress. */
export function serviceStatusForKitchen(status: KitchenStatus): ServiceStatus | null {
  if (status === 'PREPARING' || status === 'READY') return 'PREPARING'
  if (status === 'COMPLETED') return 'READY_TO_SERVE'
  return null
}

export const ORDER_SOURCES = ['POS', 'QR', 'ONLINE'] as const
export type OrderSource = (typeof ORDER_SOURCES)[number]

export const DISCOUNT_KINDS = ['NONE', 'PERCENT', 'AMOUNT'] as const
export type DiscountKind = (typeof DISCOUNT_KINDS)[number]

export const PAYMENT_METHODS = ['CASH', 'CARD', 'OTHER', 'ACCOUNT'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  OTHER: 'Other',
  ACCOUNT: 'Account'
}

/** Money that can be put in the drawer. Account sales are not included. */
export const COLLECTION_METHODS = ['CASH', 'CARD', 'OTHER'] as const
export type CollectionMethod = (typeof COLLECTION_METHODS)[number]

export const AR_ACCOUNT_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED'] as const
export type ArAccountStatus = (typeof AR_ACCOUNT_STATUSES)[number]

export const AR_ACCOUNT_STATUS_LABEL: Record<ArAccountStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed'
}

export const AR_TERMS = ['DUE_IMMEDIATELY', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM'] as const
export type ArTerms = (typeof AR_TERMS)[number]

export const AR_TERMS_LABEL: Record<ArTerms, string> = {
  DUE_IMMEDIATELY: 'Due immediately',
  NET_7: '7 days',
  NET_15: '15 days',
  NET_30: '30 days',
  NET_45: '45 days',
  NET_60: '60 days',
  CUSTOM: 'Custom'
}

export const AR_INVOICE_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOIDED', 'WRITTEN_OFF'] as const
export type ArInvoiceStatus = (typeof AR_INVOICE_STATUSES)[number]

export const AR_INVOICE_STATUS_LABEL: Record<ArInvoiceStatus, string> = {
  OPEN: 'Open',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOIDED: 'Voided',
  WRITTEN_OFF: 'Written off'
}

export const AR_LEDGER_KINDS = ['INVOICE', 'PAYMENT', 'REFUND', 'VOID', 'WRITE_OFF'] as const
export type ArLedgerKind = (typeof AR_LEDGER_KINDS)[number]

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
