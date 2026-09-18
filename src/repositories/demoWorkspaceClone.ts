import type { PoolClient } from 'pg';
import { AppError } from '../middleware/errorHandler';
import { isDemoDateBucket, resolveDemoBucketTimestamp } from '../features/demoDatePlan';

type ColumnMeta = { column_name: string; is_generated: string };

async function tableColumns(client: PoolClient, table: string): Promise<string[]> {
  const result = await client.query<ColumnMeta>(
    `SELECT column_name, is_generated
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return result.rows
    .filter((row) => {
      const generated = row.is_generated?.toUpperCase();
      if (row.column_name === 'id' || row.column_name === 'full_name') return false;
      return generated !== 'ALWAYS' && generated !== 'YES';
    })
    .map((row) => row.column_name);
}

const q = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;

const DATE_PLAN_TRIGGER_TABLES = [
  'client_cases',
  'case_documents',
  'activities',
  'contacts',
  'production_entries',
  'production_monthly_goals',
] as const;

async function setDatePlanUserTriggers(client: PoolClient, enabled: boolean): Promise<void> {
  const action = enabled ? 'ENABLE' : 'DISABLE';
  for (const table of DATE_PLAN_TRIGGER_TABLES) {
    await client.query(`ALTER TABLE ${q(table)} ${action} TRIGGER USER`);
  }
}

/**
 * Copies rows from a template table into a visitor company, remapping UUIDs via temp maps.
 */
export const copyMappedTable = async (
  client: PoolClient,
  input: {
    table: string;
    mapTable: string;
    sourceSql: string;
    sourceParams?: unknown[];
    remaps: Record<string, string>;
    nullColumns?: string[];
  }
): Promise<number> => {
  const columns = await tableColumns(client, input.table);
  await client.query(
    `CREATE TEMP TABLE ${input.mapTable} (
       old_id UUID PRIMARY KEY,
       new_id UUID NOT NULL
     ) ON COMMIT DROP`
  );
  const mapped = await client.query<{ id: string }>(input.sourceSql, input.sourceParams ?? []);
  if (mapped.rows.length === 0) return 0;

  for (const row of mapped.rows) {
    await client.query(`INSERT INTO ${input.mapTable} (old_id, new_id) VALUES ($1, gen_random_uuid())`, [
      row.id,
    ]);
  }

  const selectList = columns.map((column) => {
    if (input.nullColumns?.includes(column)) return `NULL AS ${q(column)}`;
    const mapName = input.remaps[column];
    if (mapName) {
      return `(SELECT new_id FROM ${mapName} WHERE old_id = src.${q(column)}) AS ${q(column)}`;
    }
    return `src.${q(column)}`;
  });

  await client.query(
    `INSERT INTO ${q(input.table)} (id, ${columns.map(q).join(', ')})
     SELECT map.new_id, ${selectList.join(', ')}
     FROM ${q(input.table)} src
     INNER JOIN ${input.mapTable} map ON map.old_id = src.id`
  );
  return mapped.rows.length;
};

export const applyDemoDatePlan = async (
  client: PoolClient,
  templateCompanyId: string,
  now: Date = new Date()
): Promise<void> => {
  const plans = await client.query<{
    entity_type: string;
    template_row_id: string;
    bucket: string;
    slot: number;
  }>(
    `SELECT entity_type, template_row_id, bucket, slot
     FROM demo_seed_date_plan
     WHERE template_company_id = $1`,
    [templateCompanyId]
  );

  const mapFor: Record<string, string> = {
    production: 'demo_production_map',
    activity: 'demo_activity_map',
    contact: 'demo_contact_map',
    case: 'demo_case_map',
    goal: 'demo_goal_map',
    user_mobile: 'demo_user_map',
    case_document: 'demo_case_document_map',
  };

  await setDatePlanUserTriggers(client, false);
  try {
    for (const plan of plans.rows) {
      if (!isDemoDateBucket(plan.bucket)) continue;
      const mapTable = mapFor[plan.entity_type];
      if (!mapTable) continue;
      const mapped = await client.query<{ new_id: string }>(
        `SELECT new_id FROM ${mapTable} WHERE old_id = $1`,
        [plan.template_row_id]
      );
      const newId = mapped.rows[0]?.new_id;
      if (!newId) continue;
      const at = resolveDemoBucketTimestamp(plan.bucket, plan.slot, now);
      const ymd = at.toISOString().slice(0, 10);

      if (plan.entity_type === 'production') {
        await client.query(
          `UPDATE production_entries
           SET due_date = $2::date,
               created_at = $3::timestamptz,
               updated_at = $3::timestamptz,
               issued_at = CASE
                 WHEN is_issued OR application_status = 'accepted_issued' THEN $3::timestamptz
                 ELSE NULL
               END
           WHERE id = $1`,
          [newId, ymd, at.toISOString()]
        );
      } else if (plan.entity_type === 'activity') {
        const stamp = plan.bucket === 'upcoming' ? now : at;
        await client.query(
          `UPDATE activities
           SET due_date = $2::date,
               due_at = $3::timestamptz,
               created_at = $4::timestamptz,
               updated_at = $4::timestamptz
           WHERE id = $1`,
          [newId, ymd, at.toISOString(), stamp.toISOString()]
        );
      } else if (plan.entity_type === 'contact') {
        await client.query(
          `UPDATE contacts
           SET created_at = $2::timestamptz,
               updated_at = $2::timestamptz,
               last_contacted_at = $2::timestamptz
           WHERE id = $1`,
          [newId, at.toISOString()]
        );
      } else if (plan.entity_type === 'case') {
        await client.query(
          `UPDATE client_cases
           SET created_at = $3::timestamptz,
               updated_at = $3::timestamptz,
               next_step_date = CASE
                 WHEN next_step_date IS NOT NULL THEN ($2::date + 2)
                 ELSE NULL
               END
           WHERE id = $1`,
          [newId, ymd, at.toISOString()]
        );
      } else if (plan.entity_type === 'goal') {
        await client.query(
          `UPDATE production_monthly_goals
           SET month = date_trunc('month', $2::timestamptz)::date,
               created_at = $2::timestamptz,
               updated_at = $2::timestamptz
           WHERE id = $1`,
          [newId, at.toISOString()]
        );
      } else if (plan.entity_type === 'user_mobile') {
        await client.query(
          `UPDATE users
           SET last_mobile_activity_at = $2::timestamptz
           WHERE id = $1`,
          [newId, at.toISOString()]
        );
      } else if (plan.entity_type === 'case_document') {
        await client.query(
          `UPDATE case_documents
           SET created_at = $2::timestamptz,
               updated_at = $2::timestamptz,
               sent_at = CASE WHEN sent_at IS NOT NULL THEN $2::timestamptz ELSE NULL END,
               received_at = CASE WHEN received_at IS NOT NULL THEN $2::timestamptz ELSE NULL END
           WHERE id = $1`,
          [newId, at.toISOString()]
        );
      }
    }
  } finally {
    await setDatePlanUserTriggers(client, true);
  }
};

export const cloneOperationalData = async (
  client: PoolClient,
  templateCompanyId: string,
  now: Date = new Date()
): Promise<void> => {
  const datePlanExists = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'demo_seed_date_plan'
     ) AS exists`
  );
  if (!datePlanExists.rows[0]?.exists) {
    throw new AppError(503, 'Demo date plan is not available', 'DEMO_TEMPLATE_MISSING');
  }

  await copyMappedTable(client, {
    table: 'contacts',
    mapTable: 'demo_contact_map',
    sourceSql: `SELECT c.id FROM contacts c
                INNER JOIN demo_user_map m ON m.old_id = c.user_id`,
    remaps: { user_id: 'demo_user_map' },
  });

  await copyMappedTable(client, {
    table: 'production_entries',
    mapTable: 'demo_production_map',
    sourceSql: `SELECT pe.id FROM production_entries pe
                INNER JOIN demo_user_map m ON m.old_id = pe.user_id`,
    remaps: { user_id: 'demo_user_map', contact_id: 'demo_contact_map' },
    nullColumns: ['case_id', 'source_activity_id'],
  });

  await copyMappedTable(client, {
    table: 'client_cases',
    mapTable: 'demo_case_map',
    sourceSql: `SELECT c.id FROM client_cases c
                INNER JOIN demo_user_map m ON m.old_id = c.user_id`,
    remaps: {
      user_id: 'demo_user_map',
      contact_id: 'demo_contact_map',
      linked_production_id: 'demo_production_map',
    },
  });

  await client.query(
    `UPDATE production_entries pe
     SET case_id = cmap.new_id
     FROM production_entries old_pe
     INNER JOIN demo_production_map pmap ON pmap.old_id = old_pe.id
     INNER JOIN demo_case_map cmap ON cmap.old_id = old_pe.case_id
     WHERE pe.id = pmap.new_id AND old_pe.case_id IS NOT NULL`
  );

  await copyMappedTable(client, {
    table: 'activities',
    mapTable: 'demo_activity_map',
    sourceSql: `SELECT a.id FROM activities a
                INNER JOIN demo_user_map m ON m.old_id = a.user_id`,
    remaps: {
      user_id: 'demo_user_map',
      contact_id: 'demo_contact_map',
      case_id: 'demo_case_map',
    },
    nullColumns: ['source_activity_id'],
  });

  const docsExist = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'case_documents'
     ) AS exists`
  );
  if (docsExist.rows[0]?.exists) {
    await copyMappedTable(client, {
      table: 'case_documents',
      mapTable: 'demo_case_document_map',
      sourceSql: `SELECT d.id FROM case_documents d
                  INNER JOIN demo_case_map m ON m.old_id = d.case_id`,
      remaps: { case_id: 'demo_case_map' },
    });
  }

  await client.query(
    `INSERT INTO user_subscriptions (user_id, package_id, status, trial_ends_at, current_period_end, started_at, updated_at)
     SELECT map.new_id, us.package_id, us.status, us.trial_ends_at, us.current_period_end, NOW(), NOW()
     FROM user_subscriptions us
     INNER JOIN demo_user_map map ON map.old_id = us.user_id
     ON CONFLICT (user_id) DO UPDATE
       SET package_id = EXCLUDED.package_id,
           status = EXCLUDED.status,
           trial_ends_at = EXCLUDED.trial_ends_at,
           current_period_end = EXCLUDED.current_period_end,
           updated_at = NOW()`
  );

  await copyMappedTable(client, {
    table: 'production_monthly_goals',
    mapTable: 'demo_goal_map',
    sourceSql: `SELECT g.id FROM production_monthly_goals g
                INNER JOIN demo_user_map m ON m.old_id = g.user_id`,
    remaps: { user_id: 'demo_user_map' },
  });

  await applyDemoDatePlan(client, templateCompanyId, now);
};

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table]
  );
  return Boolean(result.rows[0]?.exists);
}

/**
 * Copies company subscription, billing profile, invoices, and the enterprise contract
 * into the visitor clone. Invoice numbers are allocated from invoice_number_seq so
 * clones never reuse master numbers.
 *
 * Reset / clone commercial policy (Task 15):
 * CLONE from Northstar master: company_subscriptions, company_billing_profiles,
 *   invoices + current line items, invoice_commercial_details, enterprise_contracts
 * REGENERATE: invoice numbers (invoice_number_seq), clone-safe emails, demo date plan
 * RESET EMPTY (do not clone master/visitor transactional history):
 *   licence_increase_requests, enterprise_contract_seat_changes,
 *   enterprise_billing_adjustments, enterprise_contract_events,
 *   demo_outbox_events. Bulk import jobs and member_invitations have no demo tables.
 * Organisation Admin: Executive rank is the public-demo Organisation Admin proxy —
 *   organisation_admin_assignments is not cloned because the isolated demo does not
 *   persist that additive grant table.
 */
export const cloneCommercialData = async (
  client: PoolClient,
  templateCompanyId: string,
  companyId: string
): Promise<void> => {
  if (await tableExists(client, 'company_subscriptions')) {
    await client.query(
      `INSERT INTO company_subscriptions (
         company_id, status, package_id, started_at, next_billing_at,
         vat_registered, vat_rate_percent, billing_contact_user_id,
         billing_contact_name, billing_contact_email
       )
       SELECT
         $2,
         cs.status,
         cs.package_id,
         cs.started_at,
         cs.next_billing_at,
         FALSE,
         0,
         (SELECT new_id FROM demo_user_map WHERE old_id = cs.billing_contact_user_id),
         cs.billing_contact_name,
         COALESCE(
           (SELECT u.email FROM demo_user_map m INNER JOIN users u ON u.id = m.new_id WHERE m.old_id = cs.billing_contact_user_id),
           cs.billing_contact_email
         )
       FROM company_subscriptions cs
       WHERE cs.company_id = $1
       ON CONFLICT (company_id) DO UPDATE SET
         status = EXCLUDED.status,
         package_id = EXCLUDED.package_id,
         started_at = EXCLUDED.started_at,
         next_billing_at = EXCLUDED.next_billing_at,
         vat_registered = EXCLUDED.vat_registered,
         vat_rate_percent = EXCLUDED.vat_rate_percent,
         billing_contact_user_id = EXCLUDED.billing_contact_user_id,
         billing_contact_name = EXCLUDED.billing_contact_name,
         billing_contact_email = EXCLUDED.billing_contact_email`,
      [templateCompanyId, companyId]
    );
  }

  if (await tableExists(client, 'company_billing_profiles')) {
    await client.query(
      `INSERT INTO company_billing_profiles (
         company_id, registered_name, trading_name, registration_number,
         vat_registered, vat_number, vat_rate_percent, billing_contact_name,
         billing_email, telephone, address, city, province, postal_code, country
       )
       SELECT
         $2, registered_name, trading_name, registration_number,
         FALSE, NULL, 0, billing_contact_name,
         COALESCE(
           (SELECT u.email FROM demo_user_map m INNER JOIN users u ON u.id = m.new_id
            INNER JOIN company_subscriptions cs ON cs.billing_contact_user_id = m.old_id
            WHERE cs.company_id = $1 LIMIT 1),
           billing_email
         ),
         telephone, address, city, province, postal_code, country
       FROM company_billing_profiles
       WHERE company_id = $1
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
         country = EXCLUDED.country`,
      [templateCompanyId, companyId]
    );
  }

  if (await tableExists(client, 'enterprise_contracts')) {
    await client.query(
      `CREATE TEMP TABLE demo_contract_map (
         old_id UUID PRIMARY KEY,
         new_id UUID NOT NULL
       ) ON COMMIT DROP`
    );
    const contractColumns = await tableColumns(client, 'enterprise_contracts');
    const hasAutoActivate = contractColumns.includes('additional_seats_auto_activate');
    const contracts = await client.query<{
      id: string;
      commercial_status: string;
      contract_start_date: Date | string | null;
      contract_end_date: Date | string | null;
      auto_renew: boolean;
      committed_licences: number | null;
      billing_model: string;
      billing_frequency: string;
      pricing_basis: string;
      negotiated_unit_price_cents: number | null;
      negotiated_fixed_amount_cents: number | null;
      currency: string;
      payment_terms_code: string;
      payment_terms_custom: string | null;
      po_reference: string | null;
      billing_contact_name: string | null;
      billing_email: string | null;
      billing_notes: string | null;
      internal_notes: string | null;
      additional_seat_policy: string;
      seat_reduction_policy: string;
      additional_seats_auto_activate?: boolean;
      created_by_user_id: string;
    }>(
      `SELECT id, commercial_status, contract_start_date, contract_end_date, auto_renew,
              committed_licences, billing_model, billing_frequency, pricing_basis,
              negotiated_unit_price_cents, negotiated_fixed_amount_cents, currency,
              payment_terms_code, payment_terms_custom, po_reference,
              billing_contact_name, billing_email, billing_notes, internal_notes,
              additional_seat_policy, seat_reduction_policy,
              ${hasAutoActivate ? 'additional_seats_auto_activate,' : ''}
              created_by_user_id
       FROM enterprise_contracts
       WHERE company_id = $1`,
      [templateCompanyId]
    );

    let clonedContracts = 0;
    for (const contract of contracts.rows) {
      const createdBy =
        (
          await client.query<{ new_id: string }>(`SELECT new_id FROM demo_user_map WHERE old_id = $1`, [
            contract.created_by_user_id,
          ])
        ).rows[0]?.new_id ??
        (await client.query<{ new_id: string }>(`SELECT new_id FROM demo_user_map LIMIT 1`)).rows[0]?.new_id;
      if (!createdBy) continue;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO enterprise_contracts (
           company_id, onboarding_id, commercial_status, contract_start_date, contract_end_date,
           auto_renew, committed_licences, billing_model, billing_frequency, pricing_basis,
           negotiated_unit_price_cents, negotiated_fixed_amount_cents, currency,
           vat_applicable, vat_rate_percent, payment_terms_code, payment_terms_custom,
           po_reference, billing_contact_name, billing_email, billing_notes, internal_notes,
           additional_seat_policy, seat_reduction_policy
           ${hasAutoActivate ? ', additional_seats_auto_activate' : ''},
           created_by_user_id
         ) VALUES (
           $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           FALSE, 0, $13, $14, $15, $16, $17, $18, $19, $20, $21
           ${hasAutoActivate ? ', $23' : ''},
           $22
         ) RETURNING id`,
        [
          companyId,
          contract.commercial_status,
          contract.contract_start_date,
          contract.contract_end_date,
          contract.auto_renew,
          contract.committed_licences,
          contract.billing_model,
          contract.billing_frequency,
          contract.pricing_basis,
          contract.negotiated_unit_price_cents,
          contract.negotiated_fixed_amount_cents,
          contract.currency,
          contract.payment_terms_code,
          contract.payment_terms_custom,
          contract.po_reference,
          contract.billing_contact_name,
          contract.billing_email,
          contract.billing_notes,
          contract.internal_notes,
          contract.additional_seat_policy,
          contract.seat_reduction_policy,
          createdBy,
          ...(hasAutoActivate ? [Boolean(contract.additional_seats_auto_activate)] : []),
        ]
      );
      await client.query(`INSERT INTO demo_contract_map (old_id, new_id) VALUES ($1, $2)`, [
        contract.id,
        inserted.rows[0].id,
      ]);
      clonedContracts += 1;
    }

    if (clonedContracts === 0) {
      const createdBy = (await client.query<{ new_id: string }>(`SELECT new_id FROM demo_user_map LIMIT 1`)).rows[0]
        ?.new_id;
      if (createdBy) {
        await client.query(
          `INSERT INTO enterprise_contracts (
             company_id, commercial_status, contract_start_date, contract_end_date, auto_renew,
             committed_licences, billing_model, billing_frequency, pricing_basis,
             negotiated_unit_price_cents, currency, vat_applicable, vat_rate_percent,
             payment_terms_code, po_reference, billing_contact_name, billing_email,
             billing_notes, internal_notes, additional_seat_policy, seat_reduction_policy
             ${hasAutoActivate ? ', additional_seats_auto_activate' : ''},
             created_by_user_id
           ) VALUES (
             $1, 'active', '2026-09-01', '2027-08-31', TRUE,
             50, 'annual', 'annual', 'per_seat',
             7500, 'ZAR', FALSE, 0,
             'days_30', 'NS-ENT-2026', 'Northstar Finance', 'finance@northstar.demo.invalid',
             'AdvisorTrack Enterprise annual agreement for Northstar Advisory.',
             'Demo internal commercial notes. Never return on customer APIs.',
             'next_invoice', 'renewal_only'
             ${hasAutoActivate ? ', FALSE' : ''},
             $2
           )`,
          [companyId, createdBy]
        );
      }
    }
  }

  if (!(await tableExists(client, 'invoices'))) return;

  await client.query(
    `CREATE TEMP TABLE demo_invoice_map (
       old_id UUID PRIMARY KEY,
       new_id UUID NOT NULL
     ) ON COMMIT DROP`
  );

  const invoices = await client.query<{
    id: string;
    status: string;
    invoice_date: Date;
    due_date: Date;
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
    created_by_user_id: string;
  }>(
    `SELECT id, status, invoice_date, due_date, po_reference, notes, payment_terms, currency,
            snapshot_registered_name, snapshot_trading_name, snapshot_registration_number,
            snapshot_vat_registered, snapshot_vat_number, snapshot_billing_contact_name,
            snapshot_billing_email, snapshot_telephone, snapshot_address, snapshot_city,
            snapshot_province, snapshot_postal_code, snapshot_country,
            snapshot_plan_slug, snapshot_plan_name,
            subtotal_cents, vat_cents, total_cents,
            paid_at, payment_date, issued_at, cancelled_at, voided_at, created_by_user_id
     FROM invoices
     WHERE company_id = $1
     ORDER BY invoice_seq ASC`,
    [templateCompanyId]
  );

  for (const invoice of invoices.rows) {
    const seqResult = await client.query<{ seq: string }>(`SELECT nextval('invoice_number_seq')::text AS seq`);
    const seq = seqResult.rows[0].seq;
    const invoiceNumber = `INV${seq}`;
    const createdBy =
      (
        await client.query<{ new_id: string }>(`SELECT new_id FROM demo_user_map WHERE old_id = $1`, [
          invoice.created_by_user_id,
        ])
      ).rows[0]?.new_id ??
      (await client.query<{ new_id: string }>(`SELECT new_id FROM demo_user_map LIMIT 1`)).rows[0]?.new_id;
    if (!createdBy) continue;

    const billingEmail =
      (
        await client.query<{ email: string }>(
          `SELECT u.email
           FROM company_subscriptions cs
           INNER JOIN users u ON u.id = cs.billing_contact_user_id
           WHERE cs.company_id = $1
           LIMIT 1`,
          [companyId]
        )
      ).rows[0]?.email ?? invoice.snapshot_billing_email;

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
         paid_at, payment_date, issued_at, cancelled_at, voided_at,
         created_by_user_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29,$30,$31,$32,$33,$34
       ) RETURNING id`,
      [
        companyId,
        Number(seq),
        invoiceNumber,
        invoice.status,
        invoice.invoice_date,
        invoice.due_date,
        invoice.po_reference,
        invoice.notes,
        invoice.payment_terms,
        invoice.currency,
        invoice.snapshot_registered_name,
        invoice.snapshot_trading_name,
        invoice.snapshot_registration_number,
        false,
        null,
        invoice.snapshot_billing_contact_name,
        billingEmail,
        invoice.snapshot_telephone,
        invoice.snapshot_address,
        invoice.snapshot_city,
        invoice.snapshot_province,
        invoice.snapshot_postal_code,
        invoice.snapshot_country,
        invoice.snapshot_plan_slug,
        invoice.snapshot_plan_name,
        invoice.subtotal_cents,
        0,
        invoice.subtotal_cents,
        invoice.paid_at,
        invoice.payment_date,
        invoice.issued_at,
        invoice.cancelled_at,
        invoice.voided_at,
        createdBy,
      ]
    );
    await client.query(`INSERT INTO demo_invoice_map (old_id, new_id) VALUES ($1, $2)`, [
      invoice.id,
      inserted.rows[0].id,
    ]);
  }

  await client.query(
    `INSERT INTO invoice_line_items (
       invoice_id, sort_order, description, quantity, unit_price_cents, discount_cents,
       vat_rate_percent, line_subtotal_cents, line_vat_cents, line_total_cents, is_current
     )
     SELECT map.new_id, li.sort_order, li.description, li.quantity, li.unit_price_cents, li.discount_cents,
            0, li.line_subtotal_cents, 0, li.line_subtotal_cents, li.is_current
     FROM invoice_line_items li
     INNER JOIN demo_invoice_map map ON map.old_id = li.invoice_id
     WHERE li.is_current = TRUE`
  );

  if (await tableExists(client, 'invoice_commercial_details')) {
    const contractMapExists = (
      await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname LIKE 'pg_temp%' AND c.relname = 'demo_contract_map'
         ) AS exists`
      )
    ).rows[0]?.exists;
    await client.query(
      `INSERT INTO invoice_commercial_details (
         invoice_id, billing_period_start, billing_period_end, customer_reference, source_contract_id
       )
       SELECT map.new_id, d.billing_period_start, d.billing_period_end, d.customer_reference,
              ${
                contractMapExists
                  ? `(SELECT new_id FROM demo_contract_map WHERE old_id = d.source_contract_id)`
                  : 'NULL'
              }
       FROM invoice_commercial_details d
       INNER JOIN demo_invoice_map map ON map.old_id = d.invoice_id`
    );
  }
};
