import type {
  Branch,
  BranchSettings,
  DiningTable,
  MenuCategory,
  MenuItem,
  Order,
  OrderItem,
  Payment,
  Printer,
  Refund,
  Reservation,
  RestaurantProfile,
  User,
  QrToken
} from '@prisma/client'
import type {
  BranchDto,
  BranchSettingsDto,
  FloorTableDto,
  MenuCategoryDto,
  OrderDto,
  OrderItemDto,
  PaymentDto,
  PrinterDto,
  RefundDto,
  ReservationDto,
  RestaurantProfileDto,
  UserDto
} from '@towns/shared'

type OrderWithRelations = Order & {
  items: OrderItem[]
  payments: Payment[]
  refunds: Refund[]
  table: Pick<DiningTable, 'id' | 'label'> | null
  server: Pick<User, 'id' | 'firstName' | 'lastName'> | null
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    branchId: user.branchId,
    isActive: user.isActive
  }
}

export function toBranchDto(branch: Branch): BranchDto {
  return {
    id: branch.id,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    city: branch.city,
    phone: branch.phone,
    timezone: branch.timezone,
    isActive: branch.isActive
  }
}

export function toProfileDto(profile: RestaurantProfile): RestaurantProfileDto {
  return {
    id: profile.id,
    name: profile.name,
    legalName: profile.legalName,
    tagline: profile.tagline,
    phone: profile.phone,
    email: profile.email,
    address: profile.address
  }
}

export function toSettingsDto(settings: BranchSettings): BranchSettingsDto {
  return {
    branchId: settings.branchId,
    currency: settings.currency,
    serviceChargeBps: settings.serviceChargeBps,
    serviceChargeLabel: settings.serviceChargeLabel,
    receiptHeader: settings.receiptHeader,
    receiptFooter: settings.receiptFooter,
    showServerOnReceipt: settings.showServerOnReceipt,
    showTableOnReceipt: settings.showTableOnReceipt
  }
}

export function toPrinterDto(printer: Printer): PrinterDto {
  return {
    id: printer.id,
    branchId: printer.branchId,
    name: printer.name,
    kind: printer.kind,
    connection: printer.connection,
    address: printer.address,
    paperWidth: printer.paperWidth,
    isDefault: printer.isDefault,
    isActive: printer.isActive
  }
}

type OrderItemWithModifiers = OrderItem & {
  modifiers?: Array<{
    id: string
    orderItemId: string
    modifierGroupId: string
    modifierOptionId: string
    modifierName: string
    priceCents: number
  }>
}

export function toOrderItemDto(item: OrderItemWithModifiers): OrderItemDto {
  return {
    id: item.id,
    orderId: item.orderId,
    menuItemId: item.menuItemId,
    name: item.name,
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    notes: item.notes,
    station: item.station,
    voided: item.voided,
    sentAt: item.sentAt ? item.sentAt.toISOString() : null,
    modifiers: item.modifiers?.map((mod) => ({
      id: mod.id,
      orderItemId: mod.orderItemId,
      modifierGroupId: mod.modifierGroupId,
      modifierOptionId: mod.modifierOptionId,
      modifierName: mod.modifierName,
      priceCents: mod.priceCents
    }))
  }
}

function toPaymentDto(payment: Payment): PaymentDto {
  return {
    id: payment.id,
    method: payment.method,
    amountCents: payment.amountCents,
    tenderedCents: payment.tenderedCents,
    changeCents: payment.changeCents,
    note: payment.note,
    createdAt: payment.createdAt.toISOString()
  }
}

function toRefundDto(refund: Refund): RefundDto {
  return {
    id: refund.id,
    method: refund.method,
    amountCents: refund.amountCents,
    reason: refund.reason,
    createdAt: refund.createdAt.toISOString()
  }
}

export function toOrderDto(order: OrderWithRelations): OrderDto {
  const serverName = order.server ? `${order.server.firstName} ${order.server.lastName}` : null
  const paidCents = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  const refundedCents = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
  return {
    id: order.id,
    branchId: order.branchId,
    type: order.type,
    status: order.status,
    progress: order.progress,
    source: order.source,
    tableId: order.tableId,
    tableLabel: order.table?.label ?? null,
    serverId: order.serverId,
    serverName,
    guestName: order.guestName,
    guestPhone: order.guestPhone,
    guestCount: order.guestCount,
    deliveryAddress: order.deliveryAddress,
    notes: order.notes,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountKind: order.discountKind,
    discountValue: order.discountValue,
    discountCents: order.discountCents,
    discountLabel: order.discountLabel,
    serviceChargeCents: order.serviceChargeCents,
    totalCents: order.totalCents,
    paidCents,
    refundedCents,
    balanceCents: Math.max(0, order.totalCents - paidCents),
    refundableCents: Math.max(0, Math.min(order.totalCents, paidCents) - refundedCents),
    mergedIntoId: order.mergedIntoId,
    splitFromId: order.splitFromId,
    items: order.items.map(toOrderItemDto),
    payments: order.payments.map(toPaymentDto),
    refunds: order.refunds.map(toRefundDto),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    closedAt: order.closedAt ? order.closedAt.toISOString() : null
  }
}

export function toReservationDto(row: Reservation & { table: Pick<DiningTable, 'label'> | null }): ReservationDto {
  return {
    id: row.id,
    branchId: row.branchId,
    tableId: row.tableId,
    tableLabel: row.table?.label ?? null,
    type: row.type,
    status: row.status,
    guestName: row.guestName,
    guestPhone: row.guestPhone,
    guestCount: row.guestCount,
    reservedAt: row.reservedAt.toISOString(),
    durationMinutes: row.durationMinutes,
    depositAmountCents: row.depositAmountCents,
    depositPaid: row.depositPaid,
    notes: row.notes
  }
}

type MenuCategoryWithItems = MenuCategory & {
  items: (MenuItem & {
    modifierGroups?: Array<{
      modifierGroup: {
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
        createdAt: Date
        updatedAt: Date
        options: Array<{
          id: string
          modifierGroupId: string
          name: string
          description: string
          priceCents: number
          sortOrder: number
          isActive: boolean
        }>
      }
    }>
  })[]
}

export function toMenuDto(categories: MenuCategoryWithItems[]): MenuCategoryDto[] {
  return categories.map((category) => ({
    id: category.id,
    branchId: category.branchId,
    name: category.name,
    description: category.description,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
    items: category.items
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        station: item.station,
        isAvailable: item.isAvailable,
        sortOrder: item.sortOrder,
        modifierGroups: item.modifierGroups?.map(({ modifierGroup }) => ({
          id: modifierGroup.id,
          branchId: modifierGroup.branchId,
          name: modifierGroup.name,
          description: modifierGroup.description,
          isRequired: modifierGroup.isRequired,
          minSelections: modifierGroup.minSelections,
          maxSelections: modifierGroup.maxSelections,
          isMultipleSelect: modifierGroup.isMultipleSelect,
          sortOrder: modifierGroup.sortOrder,
          isActive: modifierGroup.isActive,
          createdAt: modifierGroup.createdAt.toISOString(),
          updatedAt: modifierGroup.updatedAt.toISOString(),
          options: modifierGroup.options.map((option) => ({
            id: option.id,
            modifierGroupId: option.modifierGroupId,
            name: option.name,
            description: option.description,
            priceCents: option.priceCents,
            sortOrder: option.sortOrder,
            isActive: option.isActive
          }))
        }))
      }))
  }))
}

export function toFloorTable(input: {
  table: DiningTable
  qr: QrToken | null
  openOrderCount: number
  activeOrder: FloorTableDto['activeOrder']
  nextReservation: FloorTableDto['nextReservation']
}): FloorTableDto {
  const { table } = input
  return {
    id: table.id,
    branchId: table.branchId,
    floorPlanId: table.floorPlanId,
    label: table.label,
    zone: table.zone,
    shape: table.shape,
    seats: table.seats,
    posX: table.posX,
    posY: table.posY,
    width: table.width,
    height: table.height,
    rotation: table.rotation,
    status: table.status,
    qrToken: input.qr?.token ?? null,
    openOrderCount: input.openOrderCount,
    activeOrder: input.activeOrder,
    nextReservation: input.nextReservation
  }
}
