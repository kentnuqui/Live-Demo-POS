import type {
  DiningProgress,
  DiscountKind,
  MenuStation,
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PrinterConnection,
  PrinterKind,
  ReservationStatus,
  ReservationType,
  TableShape,
  TableStatus,
  TableZone,
  UserRole
} from './enums.js'

export interface UserDto {
  id: string
  email: string | null
  firstName: string
  lastName: string
  role: UserRole
  branchId: string | null
  isActive: boolean
}

export interface AuthSessionDto {
  accessToken: string
  refreshToken: string
  user: UserDto
}

export interface BranchDto {
  id: string
  name: string
  code: string
  address: string
  city: string
  phone: string
  timezone: string
  isActive: boolean
}

export interface RestaurantProfileDto {
  id: string
  name: string
  legalName: string
  tagline: string
  phone: string
  email: string
  address: string
}

export interface BranchSettingsDto {
  branchId: string
  currency: string
  serviceChargeBps: number
  serviceChargeLabel: string
  receiptHeader: string
  receiptFooter: string
  showServerOnReceipt: boolean
  showTableOnReceipt: boolean
}

export interface PrinterDto {
  id: string
  branchId: string
  name: string
  kind: PrinterKind
  connection: PrinterConnection
  address: string
  paperWidth: number
  isDefault: boolean
  isActive: boolean
}

export interface FloorOrderSummary {
  id: string
  status: OrderStatus
  progress: DiningProgress
  guestCount: number
  guestName: string
  totalCents: number
  currency: string
  openedAt: string
}

export interface FloorReservationSummary {
  id: string
  guestName: string
  guestCount: number
  reservedAt: string
  type: ReservationType
}

export interface FloorTableDto {
  id: string
  branchId: string
  floorPlanId: string
  label: string
  zone: TableZone
  shape: TableShape
  seats: number
  posX: number
  posY: number
  width: number
  height: number
  rotation: number
  status: TableStatus
  qrToken: string | null
  openOrderCount: number
  activeOrder: FloorOrderSummary | null
  nextReservation: FloorReservationSummary | null
}

export interface FloorPlanDto {
  id: string
  branchId: string
  name: string
  isDefault: boolean
  tables: FloorTableDto[]
}

export interface ReservationDto {
  id: string
  branchId: string
  tableId: string | null
  tableLabel: string | null
  type: ReservationType
  status: ReservationStatus
  guestName: string
  guestPhone: string
  guestCount: number
  reservedAt: string
  durationMinutes: number
  depositAmountCents: number
  depositPaid: boolean
  notes: string
}

export interface ModifierOptionDto {
  id: string
  modifierGroupId: string
  name: string
  description: string
  priceCents: number
  sortOrder: number
  isActive: boolean
}

export interface ModifierGroupDto {
  id: string
  branchId: string
  name: string
  description: string
  isRequired: boolean
  minSelections: number
  maxSelections: number
  isMultipleSelect: boolean
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  options: ModifierOptionDto[]
}

export interface MenuItemDto {
  id: string
  categoryId: string
  name: string
  description: string
  priceCents: number
  station: MenuStation
  isAvailable: boolean
  sortOrder: number
  modifierGroups?: ModifierGroupDto[]
}

export interface MenuCategoryDto {
  id: string
  branchId: string
  name: string
  description: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
  items: MenuItemDto[]
}

export interface PaymentDto {
  id: string
  method: PaymentMethod
  amountCents: number
  tenderedCents: number
  changeCents: number
  note: string
  createdAt: string
}

export interface RefundDto {
  id: string
  method: PaymentMethod
  amountCents: number
  reason: string
  createdAt: string
}

export interface OrderItemModifierDto {
  id: string
  orderItemId: string
  modifierGroupId: string
  modifierOptionId: string
  modifierName: string
  priceCents: number
}

export interface OrderItemDto {
  id: string
  orderId: string
  menuItemId: string | null
  name: string
  unitPriceCents: number
  quantity: number
  notes: string
  station: MenuStation
  voided: boolean
  sentAt: string | null
  modifiers?: OrderItemModifierDto[]
}

export interface OrderDto {
  id: string
  branchId: string
  type: OrderType
  status: OrderStatus
  progress: DiningProgress
  source: OrderSource
  tableId: string | null
  tableLabel: string | null
  serverId: string | null
  serverName: string | null
  guestName: string
  guestPhone: string
  guestCount: number
  deliveryAddress: string
  notes: string
  currency: string
  subtotalCents: number
  discountKind: DiscountKind
  discountValue: number
  discountCents: number
  discountLabel: string
  serviceChargeCents: number
  totalCents: number
  paidCents: number
  refundedCents: number
  balanceCents: number
  refundableCents: number
  mergedIntoId: string | null
  splitFromId: string | null
  items: OrderItemDto[]
  payments: PaymentDto[]
  refunds: RefundDto[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export interface TenderTotalDto {
  method: PaymentMethod
  paymentsCents: number
  paymentCount: number
  refundsCents: number
  refundCount: number
  netCents: number
}

export interface DailyReportDto {
  day: string
  today: string
  timezone: string
  currency: string
  transactionCount: number
  grossCents: number
  discountCents: number
  serviceChargeCents: number
  salesCents: number
  refundCents: number
  refundCount: number
  netCents: number
  tenders: TenderTotalDto[]
}

export interface StationTicketDto {
  station: MenuStation
  lines: string[]
}

export interface SyncResultDto {
  operationId: string
  status: 'accepted' | 'conflict'
  message?: string
}

export interface SyncPushSummaryDto {
  accepted: number
  conflicts: SyncResultDto[]
  serverTime: string
}

export interface SyncPullDto {
  serverTime: string
  branches: BranchDto[]
  profile: RestaurantProfileDto | null
  settings: BranchSettingsDto | null
  printers: PrinterDto[]
  floorPlans: FloorPlanDto[]
  menu: MenuCategoryDto[]
  /** True when `menu` is a full replacement, including an empty catalog. */
  menuUpdated: boolean
  orders: OrderDto[]
  reservations: ReservationDto[]
  deleted: Array<{ entity: string; entityId: string; deletedAt: string }>
}
