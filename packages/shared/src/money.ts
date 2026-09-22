const EXPONENT: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KRW: 0
}

export interface ChargeSettings {
  serviceChargeBps: number
}

export interface ChargeBreakdown {
  serviceChargeCents: number
  totalCents: number
}

export interface CheckDiscount {
  kind: 'NONE' | 'PERCENT' | 'AMOUNT'
  value: number
}

/**
 * Prices are integer minor units (cents for USD, yen for JPY).
 * Rates are basis points: 800 = 8.00%, 1000 = 10.00%.
 */
export function applyCharges(subtotalCents: number, settings: ChargeSettings): ChargeBreakdown {
  const serviceChargeCents = Math.round((subtotalCents * settings.serviceChargeBps) / 10_000)
  const totalCents = subtotalCents + serviceChargeCents
  return { serviceChargeCents, totalCents }
}

/** Caps a percent or fixed discount so it never exceeds the item subtotal. */
export function discountCentsFor(subtotalCents: number, discount: CheckDiscount): number {
  if (subtotalCents <= 0 || discount.kind === 'NONE' || discount.value <= 0) return 0
  if (discount.kind === 'PERCENT') {
    const bps = Math.min(10_000, discount.value)
    return Math.min(subtotalCents, Math.round((subtotalCents * bps) / 10_000))
  }
  return Math.min(subtotalCents, discount.value)
}

/**
 * Prices a check. The discount comes off the item subtotal, then service
 * charges are calculated on what the guest actually pays for.
 */
export function priceItems(
  items: ReadonlyArray<{ unitPriceCents: number; quantity: number; voided: boolean }>,
  settings: ChargeSettings,
  discount: CheckDiscount = { kind: 'NONE', value: 0 }
): ChargeBreakdown & { subtotalCents: number; discountCents: number } {
  const subtotalCents = items
    .filter((item) => !item.voided)
    .reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0)
  const discountCents = discountCentsFor(subtotalCents, discount)
  return { subtotalCents, discountCents, ...applyCharges(subtotalCents - discountCents, settings) }
}

export function minorExponent(currency: string): number {
  return EXPONENT[currency] ?? 2
}

/** Formats minor units with the currency's real exponent so JPY is not shown as cents. */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const exponent = minorExponent(currency)
  const major = minor / 10 ** exponent
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent
  }).format(major)
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}
