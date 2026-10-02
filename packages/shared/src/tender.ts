import type { PaymentMethod } from './enums.js'

export type TenderReject = 'empty' | 'over'

export interface TenderQuote {
  /** What counts toward the check. Cash change is not included. */
  amountCents: number
  /** What the guest handed over. For cash this can be more than the amount applied. */
  tenderedCents: number
  changeCents: number
}

export interface TenderOffer {
  amountCents?: number
  tenderedCents?: number
}

/**
 * Prices one tender the same way a single payment does.
 * Cash may be more than the balance; the extra is change, not revenue.
 * Every other method must be within the balance still due.
 */
export function quoteTender(
  method: PaymentMethod,
  dueCents: number,
  input: TenderOffer
): { ok: true; quote: TenderQuote } | { ok: false; reason: TenderReject } {
  const cash = method === 'CASH'
  const offered = cash ? (input.tenderedCents ?? input.amountCents ?? 0) : (input.amountCents ?? dueCents)
  if (offered <= 0) return { ok: false, reason: 'empty' }
  if (!cash && offered > dueCents) return { ok: false, reason: 'over' }
  const amountCents = Math.min(offered, dueCents)
  return {
    ok: true,
    quote: {
      amountCents,
      tenderedCents: cash ? offered : amountCents,
      changeCents: cash ? offered - amountCents : 0
    }
  }
}

export interface SplitTenderLine extends TenderQuote {
  method: PaymentMethod
}

/**
 * Applies several tenders, in order, against one balance.
 * Stops on the first tender that the single-payment rules would reject.
 */
export function settleSplitTenders(
  dueCents: number,
  tenders: ReadonlyArray<TenderOffer & { method: PaymentMethod }>
):
  | { ok: true; lines: SplitTenderLine[]; remainingCents: number }
  | { ok: false; reason: TenderReject; index: number } {
  let due = dueCents
  const lines: SplitTenderLine[] = []
  for (let index = 0; index < tenders.length; index += 1) {
    const tender = tenders[index]
    if (!tender || due <= 0) return { ok: false, reason: 'over', index }
    const quoted = quoteTender(tender.method, due, tender)
    if (!quoted.ok) return { ok: false, reason: quoted.reason, index }
    lines.push({ method: tender.method, ...quoted.quote })
    due -= quoted.quote.amountCents
  }
  return { ok: true, lines, remainingCents: due }
}
