/**
 * Invoice lifecycle helpers. Stored status is never rewritten to "overdue".
 * Overdue is a presentation of sent invoices whose due date has passed
 * (Africa/Johannesburg calendar date).
 */

export const STORED_INVOICE_STATUSES = ['draft', 'sent', 'paid', 'cancelled', 'voided'] as const;
export type StoredInvoiceStatus = (typeof STORED_INVOICE_STATUSES)[number];
export type PresentationInvoiceStatus = StoredInvoiceStatus | 'overdue';

export const toDateOnly = (value: Date | string): string => {
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }
  return date.toISOString().slice(0, 10);
};

export const johannesburgToday = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export const addCalendarDays = (isoDate: string, days: number): string => {
  const [year, month, day] = toDateOnly(isoDate).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
};

export const presentationStatus = (
  status: string,
  dueDate: Date | string,
  now = new Date()
): PresentationInvoiceStatus => {
  if (status === 'sent' && toDateOnly(dueDate) < johannesburgToday(now)) {
    return 'overdue';
  }
  return status as PresentationInvoiceStatus;
};

export const isStoredInvoiceStatus = (value: string): value is StoredInvoiceStatus =>
  (STORED_INVOICE_STATUSES as readonly string[]).includes(value);
