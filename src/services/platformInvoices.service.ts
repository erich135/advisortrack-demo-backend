import {
  calculateInvoiceTotals,
  calculateLine,
  DEFAULT_VAT_RATE_PERCENT,
  formatQuantity,
  randToCents,
  vatRateToString,
} from '../features/invoiceMoney';
import { INVOICING_AVAILABLE_MESSAGE } from '../features/companySubscription';
import { presentationStatus, toDateOnly } from '../features/invoiceLifecycle';
import { AppError } from '../middleware/errorHandler';
import {
  BillingProfileRow,
  BillingSnapshot,
  InsertLine,
  InvoiceDeliveryEventRow,
  InvoiceLineRow,
  InvoiceRow,
  InvoiceStatusEventRow,
  invoiceRepository,
} from '../repositories/invoice.repository';
import { organisationRepository } from '../repositories/organisation.repository';
import { renderInvoicePdf } from './invoicePdf';
import { sendInvoiceEmail } from './invoiceMail';

type LineInput = {
  description: string;
  quantity: string | number;
  unitPriceCents?: number;
  unitPrice?: string | number;
  discountCents?: number;
  discount?: string | number;
  vatRatePercent?: string | number;
  lineSubtotalCents?: number;
  lineVatCents?: number;
  lineTotalCents?: number;
};

type InvoiceWriteInput = {
  companyId?: string;
  invoiceDate?: string;
  dueDate?: string;
  poReference?: string | null;
  notes?: string | null;
  paymentTerms?: string | null;
  billing?: BillingSnapshot;
  saveBillingProfile?: boolean;
  lines?: LineInput[];
  subtotalCents?: number;
  vatCents?: number;
  totalCents?: number;
};

const requireInternalAdmin = async (actorUserId: string): Promise<void> => {
  const membership = await organisationRepository.findMembership(actorUserId);
  if (!membership?.is_platform_admin) {
    throw new AppError(403, 'Platform admin access required', 'FORBIDDEN');
  }
};

const numberOrNull = (value: string | number | null | undefined): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIsoDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return toDateOnly(value);
};

const moneyError = (error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Invalid invoice amount';
  throw new AppError(400, message, 'VALIDATION_ERROR');
};

const unitPriceCentsFrom = (line: LineInput): number => {
  if (line.unitPriceCents != null) {
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      throw new AppError(400, 'unitPriceCents must be a non-negative integer', 'VALIDATION_ERROR');
    }
    return line.unitPriceCents;
  }
  if (line.unitPrice == null || String(line.unitPrice).trim() === '') {
    throw new AppError(400, 'Each line requires a unit price', 'VALIDATION_ERROR');
  }
  try {
    return randToCents(line.unitPrice);
  } catch (error) {
    return moneyError(error);
  }
};

const discountCentsFrom = (line: LineInput): number => {
  if (line.discountCents != null) {
    if (!Number.isInteger(line.discountCents) || line.discountCents < 0) {
      throw new AppError(400, 'discountCents must be a non-negative integer', 'VALIDATION_ERROR');
    }
    return line.discountCents;
  }
  if (line.discount == null || String(line.discount).trim() === '') return 0;
  try {
    return randToCents(line.discount);
  } catch (error) {
    return moneyError(error);
  }
};

const prepareLines = (rawLines: LineInput[], vatRegistered: boolean): InsertLine[] => {
  if (rawLines.length === 0) {
    throw new AppError(400, 'At least one line item is required', 'VALIDATION_ERROR');
  }
  return rawLines.map((line, index) => {
    const vatRate = vatRegistered
      ? vatRateToString(line.vatRatePercent ?? DEFAULT_VAT_RATE_PERCENT)
      : '0.00';
    let calculated;
    try {
      calculated = calculateLine({
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: unitPriceCentsFrom(line),
        discountCents: discountCentsFrom(line),
        vatRatePercent: vatRate,
      });
    } catch (error) {
      return moneyError(error);
    }
    if (line.lineSubtotalCents != null && line.lineSubtotalCents !== calculated.lineSubtotalCents) {
      throw new AppError(400, 'Line subtotal does not match server calculation', 'TOTALS_MISMATCH');
    }
    if (line.lineVatCents != null && line.lineVatCents !== calculated.lineVatCents) {
      throw new AppError(400, 'Line VAT does not match server calculation', 'TOTALS_MISMATCH');
    }
    if (line.lineTotalCents != null && line.lineTotalCents !== calculated.lineTotalCents) {
      throw new AppError(400, 'Line total does not match server calculation', 'TOTALS_MISMATCH');
    }
    return {
      sortOrder: index,
      description: calculated.description,
      quantity: calculated.quantity,
      unitPriceCents: calculated.unitPriceCents,
      discountCents: calculated.discountCents,
      vatRatePercent: calculated.vatRatePercent,
      lineSubtotalCents: calculated.lineSubtotalCents,
      lineVatCents: calculated.lineVatCents,
      lineTotalCents: calculated.lineTotalCents,
    };
  });
};

const assertTotals = (
  lines: InsertLine[],
  claimed?: { subtotalCents?: number; vatCents?: number; totalCents?: number }
) => {
  const totals = calculateInvoiceTotals(lines);
  if (claimed?.subtotalCents != null && claimed.subtotalCents !== totals.subtotalCents) {
    throw new AppError(400, 'Subtotal does not match server calculation', 'TOTALS_MISMATCH');
  }
  if (claimed?.vatCents != null && claimed.vatCents !== totals.vatCents) {
    throw new AppError(400, 'VAT total does not match server calculation', 'TOTALS_MISMATCH');
  }
  if (claimed?.totalCents != null && claimed.totalCents !== totals.totalCents) {
    throw new AppError(400, 'Invoice total does not match server calculation', 'TOTALS_MISMATCH');
  }
  return totals;
};

const snapshotFromBilling = (
  billing: BillingSnapshot,
  plan?: { slug?: string | null; name?: string | null }
): BillingSnapshot => ({
  registeredName: billing.registeredName.trim(),
  tradingName: billing.tradingName?.trim() || null,
  registrationNumber: billing.registrationNumber?.trim() || null,
  vatRegistered: Boolean(billing.vatRegistered),
  vatNumber: billing.vatNumber?.trim() || null,
  billingContactName: billing.billingContactName?.trim() || null,
  billingEmail: billing.billingEmail?.trim() || null,
  telephone: billing.telephone?.trim() || null,
  address: billing.address?.trim() || null,
  city: billing.city?.trim() || null,
  province: billing.province?.trim() || null,
  postalCode: billing.postalCode?.trim() || null,
  country: billing.country?.trim() || 'South Africa',
  planSlug: plan?.slug ?? billing.planSlug ?? null,
  planName: plan?.name ?? billing.planName ?? null,
});

const snapshotFromProfile = (
  profile: BillingProfileRow,
  plan?: { slug?: string | null; name?: string | null }
): BillingSnapshot =>
  snapshotFromBilling(
    {
      registeredName: profile.registered_name,
      tradingName: profile.trading_name,
      registrationNumber: profile.registration_number,
      vatRegistered: profile.vat_registered,
      vatNumber: profile.vat_number,
      billingContactName: profile.billing_contact_name,
      billingEmail: profile.billing_email,
      telephone: profile.telephone,
      address: profile.address,
      city: profile.city,
      province: profile.province,
      postalCode: profile.postal_code,
      country: profile.country,
    },
    plan
  );

const snapshotFromInvoice = (invoice: InvoiceRow): BillingSnapshot => ({
  registeredName: invoice.snapshot_registered_name,
  tradingName: invoice.snapshot_trading_name,
  registrationNumber: invoice.snapshot_registration_number,
  vatRegistered: invoice.snapshot_vat_registered,
  vatNumber: invoice.snapshot_vat_number,
  billingContactName: invoice.snapshot_billing_contact_name,
  billingEmail: invoice.snapshot_billing_email,
  telephone: invoice.snapshot_telephone,
  address: invoice.snapshot_address,
  city: invoice.snapshot_city,
  province: invoice.snapshot_province,
  postalCode: invoice.snapshot_postal_code,
  country: invoice.snapshot_country,
  planSlug: invoice.snapshot_plan_slug,
  planName: invoice.snapshot_plan_name,
});

const billingDto = (profile: BillingProfileRow) => ({
  companyId: profile.company_id,
  registeredName: profile.registered_name,
  tradingName: profile.trading_name,
  registrationNumber: profile.registration_number,
  vatRegistered: profile.vat_registered,
  vatNumber: profile.vat_number,
  vatRatePercent: numberOrNull(profile.vat_rate_percent),
  billingContactName: profile.billing_contact_name,
  billingEmail: profile.billing_email,
  telephone: profile.telephone,
  address: profile.address,
  city: profile.city,
  province: profile.province,
  postalCode: profile.postal_code,
  country: profile.country ?? 'South Africa',
});

const lineDto = (line: InvoiceLineRow) => ({
  id: line.id,
  sortOrder: line.sort_order,
  description: line.description,
  quantity: formatQuantity(line.quantity),
  unitPriceCents: Number(line.unit_price_cents),
  discountCents: Number(line.discount_cents),
  vatRatePercent: vatRateToString(line.vat_rate_percent),
  lineSubtotalCents: Number(line.line_subtotal_cents),
  lineVatCents: Number(line.line_vat_cents),
  lineTotalCents: Number(line.line_total_cents),
});

const eventDto = (row: InvoiceStatusEventRow) => {
  const actorName = [row.actor_first_name, row.actor_last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    createdAt: row.created_at.toISOString(),
    actor: {
      email: row.actor_email,
      name: actorName || row.actor_email,
    },
  };
};

const deliveryDto = (row: InvoiceDeliveryEventRow) => {
  const actorName = [row.actor_first_name, row.actor_last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    recipientEmail: row.recipient_email,
    errorMessage: row.error_message,
    providerMessageId: row.provider_message_id,
    snapshotRef: row.snapshot_ref,
    createdAt: row.created_at.toISOString(),
    actor: row.actor_email
      ? {
          email: row.actor_email,
          name: actorName || row.actor_email,
        }
      : null,
  };
};

const invoiceSummaryDto = (invoice: InvoiceRow) => ({
  id: invoice.id,
  companyId: invoice.company_id,
  invoiceNumber: invoice.invoice_number,
  customerName: invoice.snapshot_registered_name,
  invoiceDate: toDateOnly(invoice.invoice_date),
  dueDate: toDateOnly(invoice.due_date),
  currency: invoice.currency,
  subtotalCents: Number(invoice.subtotal_cents),
  vatCents: Number(invoice.vat_cents),
  totalCents: Number(invoice.total_cents),
  status: invoice.status,
  presentationStatus: presentationStatus(invoice.status, invoice.due_date),
  paymentDate: toIsoDate(invoice.payment_date),
  issuedAt: invoice.issued_at ? invoice.issued_at.toISOString() : null,
  createdAt: invoice.created_at.toISOString(),
});

const invoiceDetailDto = (
  invoice: InvoiceRow,
  lines: InvoiceLineRow[],
  events: InvoiceStatusEventRow[],
  deliveries: InvoiceDeliveryEventRow[]
) => ({
  ...invoiceSummaryDto(invoice),
  poReference: invoice.po_reference,
  notes: invoice.notes,
  paymentTerms: invoice.payment_terms,
  snapshot: {
    registeredName: invoice.snapshot_registered_name,
    tradingName: invoice.snapshot_trading_name,
    registrationNumber: invoice.snapshot_registration_number,
    vatRegistered: invoice.snapshot_vat_registered,
    vatNumber: invoice.snapshot_vat_number,
    billingContactName: invoice.snapshot_billing_contact_name,
    billingEmail: invoice.snapshot_billing_email,
    telephone: invoice.snapshot_telephone,
    address: invoice.snapshot_address,
    city: invoice.snapshot_city,
    province: invoice.snapshot_province,
    postalCode: invoice.snapshot_postal_code,
    country: invoice.snapshot_country,
    planSlug: invoice.snapshot_plan_slug,
    planName: invoice.snapshot_plan_name,
  },
  lines: lines.map(lineDto),
  paidAt: invoice.paid_at ? invoice.paid_at.toISOString() : null,
  cancelledAt: invoice.cancelled_at ? invoice.cancelled_at.toISOString() : null,
  voidedAt: invoice.voided_at ? invoice.voided_at.toISOString() : null,
  duplicatedFromInvoiceId: invoice.duplicated_from_invoice_id,
  updatedAt: invoice.updated_at.toISOString(),
  statusEvents: events.map(eventDto),
  deliveryEvents: deliveries.map(deliveryDto),
  lastDelivery: deliveries.length ? deliveryDto(deliveries[deliveries.length - 1]) : null,
});

const requireCustomerCompany = async (companyId: string) => {
  const row = await organisationRepository.findCompanySubscription(companyId);
  if (!row) {
    throw new AppError(404, 'Company not found', 'NOT_FOUND');
  }
  if (row.is_platform) {
    throw new AppError(400, 'Cannot create invoices for the AdvisorTrack platform company', 'CANNOT_INVOICE_PLATFORM');
  }
  return row;
};

const requireInvoice = async (invoiceId: string): Promise<InvoiceRow> => {
  const invoice = await invoiceRepository.findInvoice(invoiceId);
  if (!invoice) {
    throw new AppError(404, 'Invoice not found', 'NOT_FOUND');
  }
  return invoice;
};

const requireDraft = (invoice: InvoiceRow): void => {
  if (invoice.status !== 'draft') {
    throw new AppError(409, 'Only draft invoices can be edited', 'INVOICE_NOT_DRAFT');
  }
};

const validateDates = (invoiceDate: string, dueDate: string): void => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new AppError(400, 'Invoice and due dates must be YYYY-MM-DD', 'VALIDATION_ERROR');
  }
  if (dueDate < invoiceDate) {
    throw new AppError(400, 'Due date cannot be before the invoice date', 'VALIDATION_ERROR');
  }
};

const assertIssuable = (snapshot: BillingSnapshot): void => {
  if (!snapshot.registeredName.trim()) {
    throw new AppError(400, 'Registered company name is required', 'VALIDATION_ERROR');
  }
  if (snapshot.vatRegistered && !snapshot.vatNumber?.trim()) {
    throw new AppError(400, 'VAT number is required for VAT-registered customers when issuing an invoice', 'VAT_NUMBER_REQUIRED');
  }
};

const planFromCompany = (row: Awaited<ReturnType<typeof requireCustomerCompany>>) => ({
  slug: row.package_slug,
  name: row.package_name,
});

const persistBillingProfile = async (companyId: string, billing: BillingSnapshot, vatRatePercent?: number | null) => {
  await invoiceRepository.upsertBillingProfile({
    companyId,
    registeredName: billing.registeredName,
    tradingName: billing.tradingName,
    registrationNumber: billing.registrationNumber,
    vatRegistered: billing.vatRegistered,
    vatNumber: billing.vatNumber,
    vatRatePercent: vatRatePercent ?? (billing.vatRegistered ? DEFAULT_VAT_RATE_PERCENT : 15),
    billingContactName: billing.billingContactName,
    billingEmail: billing.billingEmail,
    telephone: billing.telephone,
    address: billing.address,
    city: billing.city,
    province: billing.province,
    postalCode: billing.postalCode,
    country: billing.country,
  });
};

const seedBillingProfile = async (companyId: string): Promise<BillingProfileRow> => {
  const existing = await invoiceRepository.findBillingProfile(companyId);
  if (existing) return existing;
  const company = await requireCustomerCompany(companyId);
  const linkedName = [company.billing_user_first_name, company.billing_user_last_name]
    .filter(Boolean)
    .join(' ')
    .trim();
  return invoiceRepository.upsertBillingProfile({
    companyId,
    registeredName: company.name,
    vatRegistered: Boolean(company.vat_registered),
    vatNumber: null,
    vatRatePercent: numberOrNull(company.vat_rate_percent) ?? 15,
    billingContactName: linkedName || company.billing_contact_name,
    billingEmail: company.billing_user_email || company.billing_contact_email,
    country: 'South Africa',
  });
};

const loadDetail = async (invoice: InvoiceRow) => {
  const [lines, events, deliveries] = await Promise.all([
    invoiceRepository.listCurrentLines(invoice.id),
    invoiceRepository.listStatusEvents(invoice.id),
    invoiceRepository.listDeliveryEvents(invoice.id),
  ]);
  return invoiceDetailDto(invoice, lines, events, deliveries);
};

const snapshotRefFor = (invoice: InvoiceRow): string =>
  `${invoice.invoice_number}@${invoice.updated_at.toISOString()}`;

/**
 * Internal AdvisorTrack invoicing. Customer roles cannot call these methods.
 */
export const platformInvoicesService = {
  async list(actorUserId: string, companyId?: string) {
    await requireInternalAdmin(actorUserId);
    if (companyId) {
      await requireCustomerCompany(companyId);
    }
    const rows = await invoiceRepository.listInvoices(companyId);
    return { invoices: rows.map(invoiceSummaryDto) };
  },

  async listForCompany(companyId: string) {
    const rows = await invoiceRepository.listInvoices(companyId);
    return rows.map(invoiceSummaryDto);
  },

  invoicingMeta() {
    return {
      available: true,
      message: INVOICING_AVAILABLE_MESSAGE,
    };
  },

  async get(actorUserId: string, invoiceId: string) {
    await requireInternalAdmin(actorUserId);
    return loadDetail(await requireInvoice(invoiceId));
  },

  async getBillingProfile(actorUserId: string, companyId: string) {
    await requireInternalAdmin(actorUserId);
    const company = await requireCustomerCompany(companyId);
    const profile = await seedBillingProfile(companyId);
    return {
      ...billingDto(profile),
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
      },
      subscription: {
        planSlug: company.package_slug,
        planName: company.package_name,
        licencePriceCents: company.price_cents,
        vatRegistered: Boolean(company.vat_registered),
        vatRatePercent: numberOrNull(company.vat_rate_percent),
        purchased: company.seat_limit,
      },
    };
  },

  async upsertBillingProfile(
    actorUserId: string,
    companyId: string,
    input: BillingSnapshot & { vatRatePercent?: number | null }
  ) {
    await requireInternalAdmin(actorUserId);
    await requireCustomerCompany(companyId);
    const snapshot = snapshotFromBilling(input);
    if (snapshot.vatRegistered && !snapshot.vatNumber?.trim()) {
      // Stored profiles may omit VAT number until an invoice is issued.
    }
    const profile = await invoiceRepository.upsertBillingProfile({
      companyId,
      registeredName: snapshot.registeredName,
      tradingName: snapshot.tradingName,
      registrationNumber: snapshot.registrationNumber,
      vatRegistered: snapshot.vatRegistered,
      vatNumber: snapshot.vatNumber,
      vatRatePercent: input.vatRatePercent ?? (snapshot.vatRegistered ? DEFAULT_VAT_RATE_PERCENT : 15),
      billingContactName: snapshot.billingContactName,
      billingEmail: snapshot.billingEmail,
      telephone: snapshot.telephone,
      address: snapshot.address,
      city: snapshot.city,
      province: snapshot.province,
      postalCode: snapshot.postalCode,
      country: snapshot.country,
    });
    return billingDto(profile);
  },

  async create(
    actorUserId: string,
    input: InvoiceWriteInput & { companyId: string; invoiceDate: string; dueDate: string; lines: LineInput[] }
  ) {
    await requireInternalAdmin(actorUserId);
    const company = await requireCustomerCompany(input.companyId);
    validateDates(input.invoiceDate, input.dueDate);
    const plan = planFromCompany(company);
    let snapshot: BillingSnapshot;
    let storedVatRate: number | null = null;
    if (input.billing) {
      snapshot = snapshotFromBilling(input.billing, plan);
    } else {
      const profile = await seedBillingProfile(input.companyId);
      storedVatRate = numberOrNull(profile.vat_rate_percent);
      snapshot = snapshotFromProfile(profile, plan);
    }
    if (!snapshot.registeredName) {
      throw new AppError(400, 'Registered company name is required', 'VALIDATION_ERROR');
    }
    if (input.saveBillingProfile !== false) {
      await persistBillingProfile(input.companyId, snapshot, storedVatRate);
    }
    const lines = prepareLines(input.lines, snapshot.vatRegistered);
    const totals = assertTotals(lines, input);
    const created = await invoiceRepository.createInvoice({
      companyId: input.companyId,
      actorUserId,
      invoiceDate: input.invoiceDate,
      dueDate: input.dueDate,
      poReference: input.poReference ?? null,
      notes: input.notes ?? null,
      paymentTerms: input.paymentTerms ?? null,
      snapshot,
      lines,
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
    });
    await organisationRepository.recordAuditEvent(actorUserId, 'invoice_created', 'invoice', {
      companyId: input.companyId,
      invoiceId: created.id,
      invoiceNumber: created.invoice_number,
      newValue: created.invoice_number,
    });
    return loadDetail(created);
  },

  async updateDraft(actorUserId: string, invoiceId: string, input: InvoiceWriteInput) {
    await requireInternalAdmin(actorUserId);
    const invoice = await requireInvoice(invoiceId);
    requireDraft(invoice);
    const invoiceDate = input.invoiceDate ?? toDateOnly(invoice.invoice_date);
    const dueDate = input.dueDate ?? toDateOnly(invoice.due_date);
    validateDates(invoiceDate, dueDate);
    const company = await requireCustomerCompany(invoice.company_id);
    const plan = planFromCompany(company);
    const snapshot = input.billing
      ? snapshotFromBilling(input.billing, plan)
      : snapshotFromInvoice(invoice);
    if (input.saveBillingProfile !== false && input.billing) {
      await persistBillingProfile(invoice.company_id, snapshot);
    }
    await invoiceRepository.updateDraftInvoice(invoiceId, {
      invoiceDate,
      dueDate,
      poReference: input.poReference,
      notes: input.notes,
      paymentTerms: input.paymentTerms,
      snapshot,
    });
    if (input.lines) {
      const lines = prepareLines(input.lines, snapshot.vatRegistered);
      const totals = assertTotals(lines, input);
      await invoiceRepository.replaceDraftLines(invoiceId, lines, totals);
    }
    const updated = await requireInvoice(invoiceId);
    return loadDetail(updated);
  },

  async send(actorUserId: string, invoiceId: string) {
    await requireInternalAdmin(actorUserId);
    const invoice = await requireInvoice(invoiceId);
    if (invoice.status === 'cancelled' || invoice.status === 'voided') {
      throw new AppError(409, 'Cancelled or voided invoices cannot be sent', 'INVALID_STATUS_TRANSITION');
    }
    const snapshot = snapshotFromInvoice(invoice);
    if (invoice.status === 'draft') {
      assertIssuable(snapshot);
    }
    const recipient = snapshot.billingEmail?.trim() || '';
    const snapshotRef = snapshotRefFor(invoice);
    const pdf = await renderInvoicePdf(invoice, await invoiceRepository.listCurrentLines(invoice.id));

    if (!recipient) {
      await invoiceRepository.insertDeliveryEvent({
        invoiceId,
        status: 'failed',
        recipientEmail: null,
        actorUserId,
        errorMessage: 'No billing email on the invoice snapshot',
        snapshotRef,
      });
      throw new AppError(
        400,
        'This invoice has no billing email. Add a billing email on the draft snapshot before sending.',
        'RECIPIENT_REQUIRED'
      );
    }

    const result = await sendInvoiceEmail({
      to: recipient,
      contactName: snapshot.billingContactName ?? null,
      invoiceNumber: invoice.invoice_number,
      invoiceDate: toDateOnly(invoice.invoice_date),
      dueDate: toDateOnly(invoice.due_date),
      totalCents: Number(invoice.total_cents),
      pdf: pdf.buffer,
      filename: pdf.filename,
    });

    if (!result.ok) {
      await invoiceRepository.insertDeliveryEvent({
        invoiceId,
        status: 'failed',
        recipientEmail: recipient,
        actorUserId,
        errorMessage: result.error ?? 'Invoice email could not be delivered',
        snapshotRef,
      });
      throw new AppError(
        502,
        result.error ?? 'Invoice email could not be delivered. The invoice was not marked Sent.',
        'INVOICE_DELIVERY_FAILED'
      );
    }

    await invoiceRepository.insertDeliveryEvent({
      invoiceId,
      status: 'sent',
      recipientEmail: recipient,
      actorUserId,
      providerMessageId: result.messageId ?? null,
      snapshotRef,
    });

    if (invoice.status === 'draft') {
      await invoiceRepository.applyStatus({
        invoiceId,
        fromStatus: 'draft',
        toStatus: 'sent',
        actorUserId,
        note: 'Sent by email',
      });
    }

    await organisationRepository.recordAuditEvent(actorUserId, 'invoice_sent', 'invoice', {
      companyId: invoice.company_id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      recipientEmail: recipient,
      snapshotRef,
      previousValue: invoice.status,
      newValue: invoice.status === 'draft' ? 'sent' : invoice.status,
    });

    return loadDetail(await requireInvoice(invoiceId));
  },

  async markPaid(actorUserId: string, invoiceId: string, paymentDate: string, note?: string) {
    await requireInternalAdmin(actorUserId);
    const invoice = await requireInvoice(invoiceId);
    if (invoice.status !== 'sent' && invoice.status !== 'draft') {
      throw new AppError(409, 'Only draft or sent invoices can be marked paid', 'INVALID_STATUS_TRANSITION');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      throw new AppError(400, 'Payment date must be YYYY-MM-DD', 'VALIDATION_ERROR');
    }
    await invoiceRepository.applyStatus({
      invoiceId,
      fromStatus: invoice.status,
      toStatus: 'paid',
      actorUserId,
      note: note ?? 'Marked paid',
      paymentDate,
    });
    await organisationRepository.recordAuditEvent(actorUserId, 'invoice_marked_paid', 'invoice', {
      companyId: invoice.company_id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      previousValue: invoice.status,
      newValue: 'paid',
      paymentDate,
    });
    return loadDetail(await requireInvoice(invoiceId));
  },

  async cancel(actorUserId: string, invoiceId: string, note?: string) {
    await requireInternalAdmin(actorUserId);
    const invoice = await requireInvoice(invoiceId);
    if (invoice.status === 'cancelled' || invoice.status === 'voided' || invoice.status === 'paid') {
      throw new AppError(409, 'This invoice cannot be cancelled', 'INVALID_STATUS_TRANSITION');
    }
    await invoiceRepository.applyStatus({
      invoiceId,
      fromStatus: invoice.status,
      toStatus: 'cancelled',
      actorUserId,
      note: note ?? 'Cancelled',
    });
    return loadDetail(await requireInvoice(invoiceId));
  },

  async void(actorUserId: string, invoiceId: string, note?: string) {
    await requireInternalAdmin(actorUserId);
    const invoice = await requireInvoice(invoiceId);
    if (invoice.status === 'voided' || invoice.status === 'cancelled') {
      throw new AppError(409, 'This invoice cannot be voided', 'INVALID_STATUS_TRANSITION');
    }
    await invoiceRepository.applyStatus({
      invoiceId,
      fromStatus: invoice.status,
      toStatus: 'voided',
      actorUserId,
      note: note ?? 'Voided',
    });
    await organisationRepository.recordAuditEvent(actorUserId, 'invoice_voided', 'invoice', {
      companyId: invoice.company_id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      previousValue: invoice.status,
      newValue: 'voided',
    });
    return loadDetail(await requireInvoice(invoiceId));
  },

  async duplicate(actorUserId: string, invoiceId: string) {
    await requireInternalAdmin(actorUserId);
    const source = await requireInvoice(invoiceId);
    const company = await requireCustomerCompany(source.company_id);
    const lines = await invoiceRepository.listCurrentLines(source.id);
    const snapshot = snapshotFromInvoice(source);
    snapshot.planSlug = snapshot.planSlug ?? company.package_slug;
    snapshot.planName = snapshot.planName ?? company.package_name;
    const insertLines: InsertLine[] = lines.map((line, index) => ({
      sortOrder: index,
      description: line.description,
      quantity: formatQuantity(line.quantity),
      unitPriceCents: Number(line.unit_price_cents),
      discountCents: Number(line.discount_cents),
      vatRatePercent: vatRateToString(line.vat_rate_percent),
      lineSubtotalCents: Number(line.line_subtotal_cents),
      lineVatCents: Number(line.line_vat_cents),
      lineTotalCents: Number(line.line_total_cents),
    }));
    const totals = calculateInvoiceTotals(insertLines);
    const created = await invoiceRepository.createInvoice({
      companyId: source.company_id,
      actorUserId,
      invoiceDate: toDateOnly(source.invoice_date),
      dueDate: toDateOnly(source.due_date),
      poReference: source.po_reference,
      notes: source.notes,
      paymentTerms: source.payment_terms,
      snapshot,
      lines: insertLines,
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
      duplicatedFromInvoiceId: source.id,
    });
    await organisationRepository.recordAuditEvent(actorUserId, 'invoice_created', 'invoice', {
      companyId: source.company_id,
      invoiceId: created.id,
      invoiceNumber: created.invoice_number,
      newValue: created.invoice_number,
      duplicatedFromInvoiceId: source.id,
    });
    return loadDetail(created);
  },

  async generatePdf(actorUserId: string, invoiceId: string) {
    await requireInternalAdmin(actorUserId);
    const invoice = await requireInvoice(invoiceId);
    const lines = await invoiceRepository.listCurrentLines(invoice.id);
    return renderInvoicePdf(invoice, lines);
  },
};
