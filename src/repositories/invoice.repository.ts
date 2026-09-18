import { getPool } from '../config/database';
import { formatInvoiceNumber } from '../features/invoiceMoney';

export type BillingProfileRow = {
  company_id: string;
  registered_name: string;
  trading_name: string | null;
  registration_number: string | null;
  vat_registered: boolean;
  vat_number: string | null;
  vat_rate_percent: string | number | null;
  billing_contact_name: string | null;
  billing_email: string | null;
  telephone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  created_at: Date;
  updated_at: Date;
};

export type InvoiceRow = {
  id: string;
  company_id: string;
  company_name: string;
  invoice_seq: string | number;
  invoice_number: string;
  status: string;
  invoice_date: Date | string;
  due_date: Date | string;
  po_reference: string | null;
  notes: string | null;
  payment_terms: string | null;
  currency: string;
  snapshot_registered_name: string;
  snapshot_trading_name: string | null;
  snapshot_registration_number: string | null;
  snapshot_vat_registered: boolean;
  snapshot_vat_number: string | null;
  snapshot_billing_contact_name: string | null;
  snapshot_billing_email: string | null;
  snapshot_telephone: string | null;
  snapshot_address: string | null;
  snapshot_city: string | null;
  snapshot_province: string | null;
  snapshot_postal_code: string | null;
  snapshot_country: string | null;
  snapshot_plan_slug: string | null;
  snapshot_plan_name: string | null;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  paid_at: Date | null;
  payment_date: Date | string | null;
  issued_at: Date | null;
  cancelled_at: Date | null;
  voided_at: Date | null;
  duplicated_from_invoice_id: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
};

export type InvoiceLineRow = {
  id: string;
  invoice_id: string;
  sort_order: number;
  description: string;
  quantity: string | number;
  unit_price_cents: number;
  discount_cents: number;
  vat_rate_percent: string | number;
  line_subtotal_cents: number;
  line_vat_cents: number;
  line_total_cents: number;
  is_current: boolean;
};

export type InvoiceStatusEventRow = {
  id: string;
  invoice_id: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string;
  note: string | null;
  created_at: Date;
  actor_email: string;
  actor_first_name: string | null;
  actor_last_name: string | null;
};

export type InvoiceDeliveryEventRow = {
  id: string;
  invoice_id: string;
  channel: string;
  status: string;
  recipient_email: string | null;
  actor_user_id: string | null;
  error_message: string | null;
  provider_message_id: string | null;
  snapshot_ref: string | null;
  created_at: Date;
  actor_email: string | null;
  actor_first_name: string | null;
  actor_last_name: string | null;
};

const INVOICE_SELECT = `
  i.id, i.company_id, c.name AS company_name, i.invoice_seq, i.invoice_number, i.status,
  i.invoice_date::text AS invoice_date, i.due_date::text AS due_date, i.po_reference, i.notes, i.payment_terms, i.currency,
  i.snapshot_registered_name, i.snapshot_trading_name, i.snapshot_registration_number,
  i.snapshot_vat_registered, i.snapshot_vat_number, i.snapshot_billing_contact_name,
  i.snapshot_billing_email, i.snapshot_telephone, i.snapshot_address, i.snapshot_city,
  i.snapshot_province, i.snapshot_postal_code, i.snapshot_country,
  i.snapshot_plan_slug, i.snapshot_plan_name,
  i.subtotal_cents, i.vat_cents, i.total_cents,
  i.paid_at, i.payment_date::text AS payment_date, i.issued_at, i.cancelled_at, i.voided_at,
  i.duplicated_from_invoice_id, i.created_by_user_id, i.created_at, i.updated_at
`;

export type BillingSnapshot = {
  registeredName: string;
  tradingName?: string | null;
  registrationNumber?: string | null;
  vatRegistered: boolean;
  vatNumber?: string | null;
  billingContactName?: string | null;
  billingEmail?: string | null;
  telephone?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  planSlug?: string | null;
  planName?: string | null;
};

export type InsertLine = {
  sortOrder: number;
  description: string;
  quantity: string;
  unitPriceCents: number;
  discountCents: number;
  vatRatePercent: string;
  lineSubtotalCents: number;
  lineVatCents: number;
  lineTotalCents: number;
};

export const invoiceRepository = {
  async findBillingProfile(companyId: string): Promise<BillingProfileRow | null> {
    const result = await getPool().query<BillingProfileRow>(
      `SELECT * FROM company_billing_profiles WHERE company_id = $1 LIMIT 1`,
      [companyId]
    );
    return result.rows[0] ?? null;
  },

  async upsertBillingProfile(input: {
    companyId: string;
    registeredName: string;
    tradingName?: string | null;
    registrationNumber?: string | null;
    vatRegistered: boolean;
    vatNumber?: string | null;
    vatRatePercent?: string | number | null;
    billingContactName?: string | null;
    billingEmail?: string | null;
    telephone?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }): Promise<BillingProfileRow> {
    const result = await getPool().query<BillingProfileRow>(
      `INSERT INTO company_billing_profiles (
         company_id, registered_name, trading_name, registration_number,
         vat_registered, vat_number, vat_rate_percent, billing_contact_name,
         billing_email, telephone, address, city, province, postal_code, country
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (company_id) DO UPDATE SET
         registered_name = EXCLUDED.registered_name,
         trading_name = EXCLUDED.trading_name,
         registration_number = EXCLUDED.registration_number,
         vat_registered = EXCLUDED.vat_registered,
         vat_number = EXCLUDED.vat_number,
         vat_rate_percent = EXCLUDED.vat_rate_percent,
         billing_contact_name = EXCLUDED.billing_contact_name,
         billing_email = EXCLUDED.billing_email,
         telephone = EXCLUDED.telephone,
         address = EXCLUDED.address,
         city = EXCLUDED.city,
         province = EXCLUDED.province,
         postal_code = EXCLUDED.postal_code,
         country = EXCLUDED.country
       RETURNING *`,
      [
        input.companyId,
        input.registeredName,
        input.tradingName ?? null,
        input.registrationNumber ?? null,
        input.vatRegistered,
        input.vatNumber ?? null,
        input.vatRatePercent ?? 15,
        input.billingContactName ?? null,
        input.billingEmail ?? null,
        input.telephone ?? null,
        input.address ?? null,
        input.city ?? null,
        input.province ?? null,
        input.postalCode ?? null,
        input.country ?? 'South Africa',
      ]
    );
    return result.rows[0];
  },

  async listInvoices(companyId?: string): Promise<InvoiceRow[]> {
    const result = await getPool().query<InvoiceRow>(
      `SELECT ${INVOICE_SELECT}
       FROM invoices i
       INNER JOIN companies c ON c.id = i.company_id
       WHERE ($1::uuid IS NULL OR i.company_id = $1)
       ORDER BY i.invoice_seq DESC`,
      [companyId ?? null]
    );
    return result.rows;
  },

  async findInvoice(id: string): Promise<InvoiceRow | null> {
    const result = await getPool().query<InvoiceRow>(
      `SELECT ${INVOICE_SELECT}
       FROM invoices i
       INNER JOIN companies c ON c.id = i.company_id
       WHERE i.id = $1
       LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  },

  async listCurrentLines(invoiceId: string): Promise<InvoiceLineRow[]> {
    const result = await getPool().query<InvoiceLineRow>(
      `SELECT id, invoice_id, sort_order, description, quantity, unit_price_cents, discount_cents,
              vat_rate_percent, line_subtotal_cents, line_vat_cents, line_total_cents, is_current
       FROM invoice_line_items
       WHERE invoice_id = $1 AND is_current = TRUE
       ORDER BY sort_order ASC, created_at ASC`,
      [invoiceId]
    );
    return result.rows;
  },

  async listAllLines(invoiceId: string): Promise<InvoiceLineRow[]> {
    const result = await getPool().query<InvoiceLineRow>(
      `SELECT id, invoice_id, sort_order, description, quantity, unit_price_cents, discount_cents,
              vat_rate_percent, line_subtotal_cents, line_vat_cents, line_total_cents, is_current
       FROM invoice_line_items
       WHERE invoice_id = $1
       ORDER BY created_at ASC`,
      [invoiceId]
    );
    return result.rows;
  },

  async listStatusEvents(invoiceId: string): Promise<InvoiceStatusEventRow[]> {
    const result = await getPool().query<InvoiceStatusEventRow>(
      `SELECT e.id, e.invoice_id, e.from_status, e.to_status, e.actor_user_id, e.note, e.created_at,
              u.email AS actor_email, u.first_name AS actor_first_name, u.last_name AS actor_last_name
       FROM invoice_status_events e
       INNER JOIN users u ON u.id = e.actor_user_id
       WHERE e.invoice_id = $1
       ORDER BY e.created_at ASC`,
      [invoiceId]
    );
    return result.rows;
  },

  async listDeliveryEvents(invoiceId: string): Promise<InvoiceDeliveryEventRow[]> {
    const result = await getPool().query<InvoiceDeliveryEventRow>(
      `SELECT e.id, e.invoice_id, e.channel, e.status, e.recipient_email, e.actor_user_id,
              e.error_message, e.provider_message_id, e.snapshot_ref, e.created_at,
              u.email AS actor_email, u.first_name AS actor_first_name, u.last_name AS actor_last_name
       FROM invoice_delivery_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.invoice_id = $1
       ORDER BY e.created_at ASC`,
      [invoiceId]
    );
    return result.rows;
  },

  async insertDeliveryEvent(input: {
    invoiceId: string;
    status: 'queued' | 'sent' | 'failed';
    recipientEmail: string | null;
    actorUserId: string;
    errorMessage?: string | null;
    providerMessageId?: string | null;
    snapshotRef?: string | null;
  }): Promise<InvoiceDeliveryEventRow> {
    const result = await getPool().query<InvoiceDeliveryEventRow>(
      `INSERT INTO invoice_delivery_events (
         invoice_id, channel, status, recipient_email, actor_user_id,
         error_message, provider_message_id, snapshot_ref
       ) VALUES ($1, 'email', $2, $3, $4, $5, $6, $7)
       RETURNING id, invoice_id, channel, status, recipient_email, actor_user_id,
                 error_message, provider_message_id, snapshot_ref, created_at,
                 NULL::varchar AS actor_email, NULL::varchar AS actor_first_name,
                 NULL::varchar AS actor_last_name`,
      [
        input.invoiceId,
        input.status,
        input.recipientEmail,
        input.actorUserId,
        input.errorMessage ?? null,
        input.providerMessageId ?? null,
        input.snapshotRef ?? null,
      ]
    );
    return result.rows[0];
  },

  async createInvoice(input: {
    companyId: string;
    actorUserId: string;
    invoiceDate: string;
    dueDate: string;
    poReference?: string | null;
    notes?: string | null;
    paymentTerms?: string | null;
    snapshot: BillingSnapshot;
    lines: InsertLine[];
    subtotalCents: number;
    vatCents: number;
    totalCents: number;
    duplicatedFromInvoiceId?: string | null;
  }): Promise<InvoiceRow> {
    const client = await getPool().connect();
    let invoiceId = '';
    try {
      await client.query('BEGIN');
      const seqResult = await client.query<{ seq: string }>(`SELECT nextval('invoice_number_seq')::text AS seq`);
      const seq = Number(seqResult.rows[0].seq);
      const invoiceNumber = formatInvoiceNumber(seq);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO invoices (
           company_id, invoice_seq, invoice_number, status, invoice_date, due_date,
           po_reference, notes, payment_terms, currency,
           snapshot_registered_name, snapshot_trading_name, snapshot_registration_number,
           snapshot_vat_registered, snapshot_vat_number, snapshot_billing_contact_name,
           snapshot_billing_email, snapshot_telephone, snapshot_address, snapshot_city,
           snapshot_province, snapshot_postal_code, snapshot_country,
           snapshot_plan_slug, snapshot_plan_name,
           subtotal_cents, vat_cents, total_cents,
           duplicated_from_invoice_id, created_by_user_id
         ) VALUES (
           $1,$2,$3,'draft',$4,$5,$6,$7,$8,'ZAR',
           $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
         ) RETURNING id`,
        [
          input.companyId,
          seq,
          invoiceNumber,
          input.invoiceDate,
          input.dueDate,
          input.poReference ?? null,
          input.notes ?? null,
          input.paymentTerms ?? null,
          input.snapshot.registeredName,
          input.snapshot.tradingName ?? null,
          input.snapshot.registrationNumber ?? null,
          input.snapshot.vatRegistered,
          input.snapshot.vatNumber ?? null,
          input.snapshot.billingContactName ?? null,
          input.snapshot.billingEmail ?? null,
          input.snapshot.telephone ?? null,
          input.snapshot.address ?? null,
          input.snapshot.city ?? null,
          input.snapshot.province ?? null,
          input.snapshot.postalCode ?? null,
          input.snapshot.country ?? null,
          input.snapshot.planSlug ?? null,
          input.snapshot.planName ?? null,
          input.subtotalCents,
          input.vatCents,
          input.totalCents,
          input.duplicatedFromInvoiceId ?? null,
          input.actorUserId,
        ]
      );
      invoiceId = inserted.rows[0].id;
      for (const line of input.lines) {
        await client.query(
          `INSERT INTO invoice_line_items (
             invoice_id, sort_order, description, quantity, unit_price_cents, discount_cents,
             vat_rate_percent, line_subtotal_cents, line_vat_cents, line_total_cents, is_current
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE)`,
          [
            invoiceId,
            line.sortOrder,
            line.description,
            line.quantity,
            line.unitPriceCents,
            line.discountCents,
            line.vatRatePercent,
            line.lineSubtotalCents,
            line.lineVatCents,
            line.lineTotalCents,
          ]
        );
      }
      await client.query(
        `INSERT INTO invoice_status_events (invoice_id, from_status, to_status, actor_user_id, note)
         VALUES ($1, NULL, 'draft', $2, $3)`,
        [invoiceId, input.actorUserId, input.duplicatedFromInvoiceId ? 'Duplicated from prior invoice' : 'Created']
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const created = await this.findInvoice(invoiceId);
    if (!created) {
      throw new Error('Created invoice could not be reloaded');
    }
    return created;
  },

  async replaceDraftLines(
    invoiceId: string,
    lines: InsertLine[],
    totals: { subtotalCents: number; vatCents: number; totalCents: number }
  ): Promise<void> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE invoice_line_items
         SET is_current = FALSE, replaced_at = NOW()
         WHERE invoice_id = $1 AND is_current = TRUE`,
        [invoiceId]
      );
      for (const line of lines) {
        await client.query(
          `INSERT INTO invoice_line_items (
             invoice_id, sort_order, description, quantity, unit_price_cents, discount_cents,
             vat_rate_percent, line_subtotal_cents, line_vat_cents, line_total_cents, is_current
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE)`,
          [
            invoiceId,
            line.sortOrder,
            line.description,
            line.quantity,
            line.unitPriceCents,
            line.discountCents,
            line.vatRatePercent,
            line.lineSubtotalCents,
            line.lineVatCents,
            line.lineTotalCents,
          ]
        );
      }
      await client.query(
        `UPDATE invoices
         SET subtotal_cents = $2, vat_cents = $3, total_cents = $4
         WHERE id = $1`,
        [invoiceId, totals.subtotalCents, totals.vatCents, totals.totalCents]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async updateDraftInvoice(
    invoiceId: string,
    input: {
      invoiceDate?: string;
      dueDate?: string;
      poReference?: string | null;
      notes?: string | null;
      paymentTerms?: string | null;
      snapshot?: BillingSnapshot;
    }
  ): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [invoiceId];
    let param = 2;
    if (input.invoiceDate !== undefined) {
      sets.push(`invoice_date = $${param++}`);
      values.push(input.invoiceDate);
    }
    if (input.dueDate !== undefined) {
      sets.push(`due_date = $${param++}`);
      values.push(input.dueDate);
    }
    if (input.poReference !== undefined) {
      sets.push(`po_reference = $${param++}`);
      values.push(input.poReference);
    }
    if (input.notes !== undefined) {
      sets.push(`notes = $${param++}`);
      values.push(input.notes);
    }
    if (input.paymentTerms !== undefined) {
      sets.push(`payment_terms = $${param++}`);
      values.push(input.paymentTerms);
    }
    if (input.snapshot) {
      sets.push(`snapshot_registered_name = $${param++}`);
      values.push(input.snapshot.registeredName);
      sets.push(`snapshot_trading_name = $${param++}`);
      values.push(input.snapshot.tradingName ?? null);
      sets.push(`snapshot_registration_number = $${param++}`);
      values.push(input.snapshot.registrationNumber ?? null);
      sets.push(`snapshot_vat_registered = $${param++}`);
      values.push(input.snapshot.vatRegistered);
      sets.push(`snapshot_vat_number = $${param++}`);
      values.push(input.snapshot.vatNumber ?? null);
      sets.push(`snapshot_billing_contact_name = $${param++}`);
      values.push(input.snapshot.billingContactName ?? null);
      sets.push(`snapshot_billing_email = $${param++}`);
      values.push(input.snapshot.billingEmail ?? null);
      sets.push(`snapshot_telephone = $${param++}`);
      values.push(input.snapshot.telephone ?? null);
      sets.push(`snapshot_address = $${param++}`);
      values.push(input.snapshot.address ?? null);
      sets.push(`snapshot_city = $${param++}`);
      values.push(input.snapshot.city ?? null);
      sets.push(`snapshot_province = $${param++}`);
      values.push(input.snapshot.province ?? null);
      sets.push(`snapshot_postal_code = $${param++}`);
      values.push(input.snapshot.postalCode ?? null);
      sets.push(`snapshot_country = $${param++}`);
      values.push(input.snapshot.country ?? null);
      sets.push(`snapshot_plan_slug = $${param++}`);
      values.push(input.snapshot.planSlug ?? null);
      sets.push(`snapshot_plan_name = $${param++}`);
      values.push(input.snapshot.planName ?? null);
    }
    if (sets.length === 0) return;
    await getPool().query(`UPDATE invoices SET ${sets.join(', ')} WHERE id = $1`, values);
  },

  async findInvoiceByNumber(invoiceNumber: string): Promise<InvoiceRow | null> {
    const result = await getPool().query<InvoiceRow>(
      `SELECT ${INVOICE_SELECT}
       FROM invoices i
       INNER JOIN companies c ON c.id = i.company_id
       WHERE i.invoice_number = $1
       LIMIT 1`,
      [invoiceNumber]
    );
    return result.rows[0] ?? null;
  },

  async applyStatus(input: {
    invoiceId: string;
    fromStatus: string;
    toStatus: string;
    actorUserId: string;
    note?: string | null;
    paymentDate?: string | null;
  }): Promise<void> {
    const extra: string[] = [];
    const values: unknown[] = [input.invoiceId, input.toStatus];
    let param = 3;
    if (input.toStatus === 'sent') {
      extra.push(`issued_at = COALESCE(issued_at, NOW())`);
    }
    if (input.toStatus === 'paid') {
      extra.push(`paid_at = NOW()`);
      extra.push(`payment_date = $${param++}`);
      values.push(input.paymentDate ?? new Date().toISOString().slice(0, 10));
    }
    if (input.toStatus === 'cancelled') {
      extra.push(`cancelled_at = NOW()`);
    }
    if (input.toStatus === 'voided') {
      extra.push(`voided_at = NOW()`);
    }
    const extraSql = extra.length ? `, ${extra.join(', ')}` : '';
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE invoices SET status = $2${extraSql} WHERE id = $1`, values);
      await client.query(
        `INSERT INTO invoice_status_events (invoice_id, from_status, to_status, actor_user_id, note)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.invoiceId, input.fromStatus, input.toStatus, input.actorUserId, input.note ?? null]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async countInvoices(): Promise<number> {
    const result = await getPool().query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM invoices`);
    return Number(result.rows[0]?.count ?? 0);
  },

  async countLines(invoiceId: string): Promise<number> {
    const result = await getPool().query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM invoice_line_items WHERE invoice_id = $1`,
      [invoiceId]
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  async insertLifecycleEvent(input: {
    invoiceId: string;
    fromStatus: string | null;
    toStatus: string;
    actorUserId: string;
    note?: string | null;
  }): Promise<void> {
    await getPool().query(
      `INSERT INTO invoice_status_events (invoice_id, from_status, to_status, actor_user_id, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.invoiceId, input.fromStatus, input.toStatus, input.actorUserId, input.note ?? null]
    );
  },

  async getCommercialDetails(invoiceId: string): Promise<{
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    customerReference: string | null;
    sourceContractId: string | null;
  } | null> {
    try {
      const result = await getPool().query<{
        billing_period_start: Date | string | null;
        billing_period_end: Date | string | null;
        customer_reference: string | null;
        source_contract_id: string | null;
      }>(
        `SELECT billing_period_start, billing_period_end, customer_reference, source_contract_id
         FROM invoice_commercial_details WHERE invoice_id = $1`,
        [invoiceId]
      );
      const row = result.rows[0];
      if (!row) return null;
      const dateOnly = (value: Date | string | null): string | null => {
        if (!value) return null;
        return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
      };
      return {
        billingPeriodStart: dateOnly(row.billing_period_start),
        billingPeriodEnd: dateOnly(row.billing_period_end),
        customerReference: row.customer_reference,
        sourceContractId: row.source_contract_id,
      };
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === '42P01') {
        return null;
      }
      throw error;
    }
  },

  async upsertCommercialDetails(
    invoiceId: string,
    input: {
      billingPeriodStart?: string | null;
      billingPeriodEnd?: string | null;
      customerReference?: string | null;
      sourceContractId?: string | null;
    }
  ): Promise<void> {
    try {
      await getPool().query(
        `INSERT INTO invoice_commercial_details (
           invoice_id, billing_period_start, billing_period_end, customer_reference, source_contract_id
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (invoice_id) DO UPDATE SET
           billing_period_start = EXCLUDED.billing_period_start,
           billing_period_end = EXCLUDED.billing_period_end,
           customer_reference = EXCLUDED.customer_reference,
           source_contract_id = EXCLUDED.source_contract_id`,
        [
          invoiceId,
          input.billingPeriodStart ?? null,
          input.billingPeriodEnd ?? null,
          input.customerReference ?? null,
          input.sourceContractId ?? null,
        ]
      );
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && (error as { code: string }).code === '42P01') {
        return;
      }
      throw error;
    }
  },
};
