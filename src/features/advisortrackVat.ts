/**
 * AdvisorTrack seller VAT policy.
 *
 * AdvisorTrack is not currently registered for VAT. Customer invoices must not
 * add VAT, imply VAT included, or print an AdvisorTrack VAT number.
 *
 * Fields such as vat_applicable / vat_rate_percent stay on records for a future
 * registration change. Charging VAT is impossible while this flag is false.
 */

export const ADVISORTRACK_VAT_REGISTERED = false as const;
export const ADVISORTRACK_VAT_NUMBER: string | null = null;
export const FUTURE_STANDARD_VAT_RATE_PERCENT = '15.00';
export const DISABLED_VAT_RATE_PERCENT = '0.00';

export function sellerChargesVat(): boolean {
  return Boolean(ADVISORTRACK_VAT_REGISTERED);
}

export function sellerVatRatePercent(): string {
  return sellerChargesVat() ? FUTURE_STANDARD_VAT_RATE_PERCENT : DISABLED_VAT_RATE_PERCENT;
}

export function sellerVatNumber(): string | null {
  return sellerChargesVat() ? ADVISORTRACK_VAT_NUMBER : null;
}

export function customerInvoiceVatLabel(): string {
  return sellerChargesVat() ? 'VAT registered' : 'VAT not charged';
}

/**
 * Rate used when creating AdvisorTrack invoices. Ignores customer VAT-vendor
 * status and any requested rate while AdvisorTrack is unregistered.
 */
export function vatRateForNewInvoiceLine(requested?: string | number | null): string {
  if (!sellerChargesVat()) return DISABLED_VAT_RATE_PERCENT;
  if (requested == null || String(requested).trim() === '') return FUTURE_STANDARD_VAT_RATE_PERCENT;
  return String(requested);
}
