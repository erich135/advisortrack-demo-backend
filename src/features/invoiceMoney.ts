/**
 * Integer-cent money math for AdvisorTrack invoices.
 * Stored amounts are integer cents. Do not persist IEEE floating-point money.
 * Rounding: half away from zero to the nearest cent (standard two-decimal Rand).
 */

const QUANTITY_SCALE = 10000n;
const VAT_SCALE = 100n;
const PERCENT_DIVISOR = 10000n;

export const DEFAULT_VAT_RATE_PERCENT = '15.00';

export const roundHalfAwayFromZero = (value: bigint, divisor: bigint): bigint => {
  if (divisor === 0n) {
    throw new Error('Division by zero');
  }
  const absValue = value < 0n ? -value : value;
  const absDivisor = divisor < 0n ? -divisor : divisor;
  const rounded = (absValue + absDivisor / 2n) / absDivisor;
  const negative = value < 0n !== divisor < 0n;
  return negative ? -rounded : rounded;
};

const parseDecimalToScaled = (raw: string | number, scale: bigint): bigint => {
  const text = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Invalid decimal: ${raw}`);
  }
  const negative = text.startsWith('-');
  const [wholePart, fractionPart = ''] = (negative ? text.slice(1) : text).split('.');
  const scaleDigits = scale.toString().length - 1;
  const padded = fractionPart.padEnd(scaleDigits + 1, '0');
  const main = padded.slice(0, scaleDigits);
  const remainderDigit = padded.slice(scaleDigits, scaleDigits + 1);
  let scaled = BigInt(wholePart || '0') * scale + BigInt(main || '0');
  if (remainderDigit !== '' && remainderDigit >= '5') {
    scaled += 1n;
  }
  return negative ? -scaled : scaled;
};

export const randToCents = (raw: string | number): number => {
  const scaled = parseDecimalToScaled(raw, 100n);
  return Number(scaled);
};

export const centsToRand = (cents: number): string => {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const rand = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${rand}` : rand;
};

export const parseVatRatePercent = (raw: string | number | null | undefined, fallback = '0'): bigint => {
  const value = raw == null || String(raw).trim() === '' ? fallback : raw;
  return parseDecimalToScaled(value, VAT_SCALE);
};

export const vatRateToString = (raw: string | number): string => {
  const scaled = parseVatRatePercent(raw, '0');
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / VAT_SCALE;
  const frac = abs % VAT_SCALE;
  const text = `${whole}.${frac.toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
};

export type InvoiceLineInput = {
  description: string;
  quantity: string | number;
  unitPriceCents: number;
  discountCents?: number;
  vatRatePercent?: string | number;
};

export type InvoiceLineAmounts = {
  description: string;
  quantity: string;
  unitPriceCents: number;
  discountCents: number;
  vatRatePercent: string;
  lineSubtotalCents: number;
  lineVatCents: number;
  lineTotalCents: number;
};

export type InvoiceTotals = {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
};

const quantityToString = (raw: string | number): string => {
  const scaled = parseDecimalToScaled(raw, QUANTITY_SCALE);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / QUANTITY_SCALE;
  const frac = abs % QUANTITY_SCALE;
  const trimmedFrac = frac.toString().padStart(4, '0').replace(/0+$/, '');
  const text = trimmedFrac ? `${whole}.${trimmedFrac}` : whole.toString();
  return negative ? `-${text}` : text;
};

export const formatQuantity = (raw: string | number): string => quantityToString(raw);

export const calculateLine = (input: InvoiceLineInput): InvoiceLineAmounts => {
  if (!Number.isInteger(input.unitPriceCents)) {
    throw new Error('unitPriceCents must be an integer');
  }
  const discountCents = input.discountCents ?? 0;
  if (!Number.isInteger(discountCents) || discountCents < 0) {
    throw new Error('discountCents must be a non-negative integer');
  }
  const quantityScaled = parseDecimalToScaled(input.quantity, QUANTITY_SCALE);
  if (quantityScaled <= 0n) {
    throw new Error('quantity must be greater than zero');
  }
  const grossCents = roundHalfAwayFromZero(quantityScaled * BigInt(input.unitPriceCents), QUANTITY_SCALE);
  if (grossCents < 0n && discountCents > 0) {
    throw new Error('discount cannot apply to a negative unit-price line');
  }
  if (discountCents > 0 && BigInt(discountCents) > grossCents) {
    throw new Error('discount cannot exceed line gross');
  }
  const lineSubtotalCents = Number(grossCents - BigInt(discountCents));
  const vatScaled = parseVatRatePercent(input.vatRatePercent ?? '0', '0');
  const lineVatCents = Number(
    roundHalfAwayFromZero(BigInt(lineSubtotalCents) * vatScaled, PERCENT_DIVISOR)
  );
  return {
    description: input.description.trim(),
    quantity: quantityToString(input.quantity),
    unitPriceCents: input.unitPriceCents,
    discountCents,
    vatRatePercent: vatRateToString(input.vatRatePercent ?? '0'),
    lineSubtotalCents,
    lineVatCents,
    lineTotalCents: lineSubtotalCents + lineVatCents,
  };
};

export const calculateInvoiceTotals = (lines: InvoiceLineAmounts[]): InvoiceTotals => {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineSubtotalCents, 0);
  const vatCents = lines.reduce((sum, line) => sum + line.lineVatCents, 0);
  return {
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
  };
};

export const formatInvoiceNumber = (seq: number | bigint): string => `INV${seq.toString()}`;
