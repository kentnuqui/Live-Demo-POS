import type { Prisma } from '@prisma/client'
import {
  availableCredit,
  invoiceStatus,
  termDays,
  termsLabel,
  type ArAccountDto,
  type ArAuditDto,
  type ArInvoiceDto,
  type ArLedgerEntryDto,
  type ArPaymentDto
} from '@towns/shared'
import { shiftDay } from '../lib/day.js'

const person = { select: { firstName: true, lastName: true } }

export const invoiceInclude = {
  account: { select: { accountNumber: true, companyName: true, customerName: true } },
  cashier: person
} satisfies Prisma.ArInvoiceInclude

export const paymentInclude = {
  account: { select: { companyName: true, accountNumber: true } },
  cashier: person,
  allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } }
} satisfies Prisma.ArPaymentInclude

type AccountRow = Prisma.ArAccountGetPayload<object>
type InvoiceRow = Prisma.ArInvoiceGetPayload<{ include: typeof invoiceInclude }>
type PaymentRow = Prisma.ArPaymentGetPayload<{ include: typeof paymentInclude }>
type LedgerRow = Prisma.ArLedgerEntryGetPayload<object>
type AuditRow = Prisma.ArAuditLogGetPayload<{
  include: { user: typeof person; approver: typeof person }
}>

function staffName(user: { firstName: string; lastName: string } | null): string | null {
  if (!user) return null
  return `${user.firstName} ${user.lastName}`.trim()
}

export function toAccountDto(account: AccountRow, today: string): ArAccountDto {
  const days = termDays(account.paymentTerms, account.customTermDays)
  return {
    id: account.id,
    branchId: account.branchId,
    accountNumber: account.accountNumber,
    customerName: account.customerName,
    companyName: account.companyName,
    contactPerson: account.contactPerson,
    phone: account.phone,
    email: account.email,
    address: account.address,
    creditLimitCents: account.creditLimitCents,
    enforceCreditLimit: account.enforceCreditLimit,
    availableCents: availableCredit(account.creditLimitCents, account.balanceCents),
    paymentTerms: account.paymentTerms,
    termDays: days,
    termsLabel: termsLabel(account.paymentTerms, account.customTermDays),
    dueOnPreview: shiftDay(today, days),
    status: account.status,
    notes: account.notes,
    balanceCents: account.balanceCents,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString()
  }
}

export function toInvoiceDto(invoice: InvoiceRow, today: string): ArInvoiceDto {
  const voided = invoice.status === 'VOIDED' || invoice.voidedAt != null
  const status = invoiceStatus({
    originalCents: invoice.originalCents,
    paidCents: invoice.paidCents,
    refundedCents: invoice.refundedCents,
    writtenOffCents: invoice.writtenOffCents,
    voided,
    dueOn: invoice.dueOn,
    today
  })
  return {
    id: invoice.id,
    branchId: invoice.branchId,
    accountId: invoice.accountId,
    accountNumber: invoice.account.accountNumber,
    companyName: invoice.account.companyName,
    customerName: invoice.account.customerName,
    orderId: invoice.orderId,
    invoiceNumber: invoice.invoiceNumber,
    cashierName: staffName(invoice.cashier),
    originalCents: invoice.originalCents,
    paidCents: invoice.paidCents,
    refundedCents: invoice.refundedCents,
    writtenOffCents: invoice.writtenOffCents,
    remainingCents: invoice.remainingCents,
    invoiceOn: invoice.invoiceOn,
    dueOn: invoice.dueOn,
    paymentTerms: invoice.terms,
    termDays: invoice.termDays,
    termsLabel: termsLabel(invoice.terms, invoice.termDays),
    status,
    notes: invoice.notes,
    voidReason: invoice.voidReason,
    voidedAt: invoice.voidedAt ? invoice.voidedAt.toISOString() : null,
    createdAt: invoice.createdAt.toISOString()
  }
}

export function toLedgerDto(entry: LedgerRow): ArLedgerEntryDto {
  return {
    id: entry.id,
    kind: entry.kind,
    debitCents: entry.debitCents,
    creditCents: entry.creditCents,
    balanceCents: entry.balanceCents,
    reference: entry.reference,
    description: entry.description,
    createdAt: entry.createdAt.toISOString()
  }
}

export function toPaymentDto(payment: PaymentRow): ArPaymentDto {
  return {
    id: payment.id,
    accountId: payment.accountId,
    companyName: payment.account.companyName,
    accountNumber: payment.account.accountNumber,
    method: payment.method,
    amountCents: payment.amountCents,
    appliedCents: payment.appliedCents,
    unappliedCents: payment.unappliedCents,
    refundedCents: payment.refundedCents,
    reference: payment.reference,
    notes: payment.notes,
    cashierName: staffName(payment.cashier),
    createdAt: payment.createdAt.toISOString(),
    allocations: payment.allocations.map((row) => ({
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoice.invoiceNumber,
      amountCents: row.amountCents
    }))
  }
}

export function toAuditDto(row: AuditRow): ArAuditDto {
  return {
    id: row.id,
    action: row.action,
    message: row.message,
    amountCents: row.amountCents,
    reason: row.reason,
    userName: staffName(row.user),
    approverName: staffName(row.approver),
    createdAt: row.createdAt.toISOString()
  }
}
