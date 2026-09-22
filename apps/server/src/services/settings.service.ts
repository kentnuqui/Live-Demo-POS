import type { BranchSettingsInput, PrinterInput, ProfileInput, ReceiptInput } from '@towns/shared'
import { AppError } from '../lib/app-error.js'
import { prisma } from '../lib/prisma.js'
import { publish, context, type ServiceContext } from '../lib/context.js'
import { toPrinterDto, toProfileDto, toSettingsDto } from '../lib/mappers.js'

/** The single restaurant profile shared by every branch. */
export async function getProfile() {
  const profile = await prisma.restaurantProfile.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!profile) throw new AppError(404, 'Restaurant profile is not set')
  return toProfileDto(profile)
}

export async function updateProfile(input: ProfileInput) {
  const existing = await prisma.restaurantProfile.findFirst({ orderBy: { createdAt: 'asc' } })
  const data = {
    name: input.name.trim(),
    legalName: input.legalName?.trim() ?? '',
    tagline: input.tagline?.trim() ?? '',
    phone: input.phone?.trim() ?? '',
    email: input.email?.trim() ?? '',
    address: input.address?.trim() ?? ''
  }
  const profile = existing
    ? await prisma.restaurantProfile.update({ where: { id: existing.id }, data })
    : await prisma.restaurantProfile.create({ data })
  return toProfileDto(profile)
}

export async function getSettings(branchId: string) {
  const settings = await prisma.branchSettings.findUnique({ where: { branchId } })
  if (!settings) throw new AppError(404, 'Branch settings not found')
  return toSettingsDto(settings)
}

/** Tax and service charge. Stored in basis points so totals stay integer. */
export async function updateSettings(branchId: string, input: BranchSettingsInput, ctx?: Partial<ServiceContext>) {
  const current = context(ctx)
  const settings = await current.db.branchSettings.update({
    where: { branchId },
    data: {
      currency: input.currency.toUpperCase(),
      serviceChargeBps: input.serviceChargeBps,
      serviceChargeLabel: input.serviceChargeLabel.trim()
    }
  })
  publish(current, branchId, 'settings.updated')
  return toSettingsDto(settings)
}

export async function updateReceipt(branchId: string, input: ReceiptInput) {
  const settings = await prisma.branchSettings.update({
    where: { branchId },
    data: {
      receiptHeader: input.receiptHeader,
      receiptFooter: input.receiptFooter,
      showServerOnReceipt: input.showServerOnReceipt,
      showTableOnReceipt: input.showTableOnReceipt
    }
  })
  publish(context(), branchId, 'settings.updated')
  return toSettingsDto(settings)
}

export async function listPrinters(branchId: string) {
  const printers = await prisma.printer.findMany({ where: { branchId }, orderBy: { name: 'asc' } })
  return printers.map(toPrinterDto)
}

/** Saves a printer. Marking one as default clears the flag on the others of the same kind. */
export async function createPrinter(branchId: string, input: PrinterInput) {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.printer.updateMany({ where: { branchId, kind: input.kind }, data: { isDefault: false } })
    }
    const printer = await tx.printer.create({
      data: {
        branchId,
        name: input.name.trim(),
        kind: input.kind,
        connection: input.connection,
        address: input.address?.trim() ?? '',
        paperWidth: input.paperWidth,
        isDefault: input.isDefault ?? false,
        isActive: input.isActive ?? true
      }
    })
    publish(context(), branchId, 'settings.updated')
    return toPrinterDto(printer)
  })
}

export async function updatePrinter(branchId: string, printerId: string, input: PrinterInput) {
  const existing = await prisma.printer.findFirst({ where: { id: printerId, branchId } })
  if (!existing) throw new AppError(404, 'Printer not found')
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.printer.updateMany({
        where: { branchId, kind: input.kind, id: { not: printerId } },
        data: { isDefault: false }
      })
    }
    const printer = await tx.printer.update({
      where: { id: printerId },
      data: {
        name: input.name.trim(),
        kind: input.kind,
        connection: input.connection,
        address: input.address?.trim() ?? '',
        paperWidth: input.paperWidth,
        isDefault: input.isDefault ?? false,
        isActive: input.isActive ?? true
      }
    })
    publish(context(), branchId, 'settings.updated')
    return toPrinterDto(printer)
  })
}

export async function deletePrinter(branchId: string, printerId: string) {
  const existing = await prisma.printer.findFirst({ where: { id: printerId, branchId } })
  if (!existing) throw new AppError(404, 'Printer not found')
  await prisma.printer.delete({ where: { id: printerId } })
  publish(context(), branchId, 'settings.updated')
}
