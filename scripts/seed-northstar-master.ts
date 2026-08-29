/**
 * Seeds the Phase 14 Northstar Advisory master template into advisortrack_demo.
 * Refuses any other database. Archives the Phase 11 template; never deletes.
 *
 * Run: npm run db:seed:demo
 */
import crypto from 'crypto';
import pg from 'pg';
import {
  NORTHSTAR_ASSIGNED_LICENCES,
  NORTHSTAR_COMPANY_ID,
  NORTHSTAR_COMPANY_NAME,
  NORTHSTAR_EMAIL_DOMAIN,
  NORTHSTAR_INVOICE_COUNT,
  NORTHSTAR_PASSWORD_HASH,
  NORTHSTAR_PERSONAS,
  NORTHSTAR_REGIONS,
  NORTHSTAR_SEAT_LIMIT,
  NORTHSTAR_SEED_VERSION,
  NORTHSTAR_TEMPLATE_SLUG,
  NORTHSTAR_VERSION_LABEL,
  PHASE11_TEMPLATE_COMPANY_ID,
  countNorthstarPeople,
  northstarEmail,
} from '../src/features/demoNorthstar';
import type { DemoDateBucket } from '../src/features/demoDatePlan';
import {
  calculateInvoiceTotals,
  calculateLine,
  DEFAULT_VAT_RATE_PERCENT,
  formatInvoiceNumber,
} from '../src/features/invoiceMoney';

import {
  CASE_DOCUMENTS,
  currentMonthIssuedFor,
  extraCasesFor,
  mobileBucketFor,
} from '../src/features/northstarAdvisorStories';

const DEMO_DB = 'advisortrack_demo';
const PRODUCTS = [
  'Life Cover',
  'Retirement',
  'Investments',
  'Disability',
  'Medical Aid',
  'Estate Planning',
] as const;
const STAGES = [
  'Initial Contact',
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review',
] as const;
const FIRST_NAMES = [
  'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Isla', 'Leo', 'Mila', 'Kai', 'Sara',
  'Ben', 'Lara', 'Max', 'Nia', 'Jon', 'Eva', 'Sam', 'Zoe', 'Ian', 'Amy',
  'Ruben', 'Palesa', 'Craig', 'Anika', 'Tumi', 'Helen', 'Pieter', 'Naledi', 'James', 'Amina',
];
const LAST_NAMES = [
  'Wright', 'Adams', 'Baker', 'Cole', 'Diaz', 'Evans', 'Frost', 'Green', 'Hayes', 'Iyer',
  'Jones', 'King', 'Lewis', 'Moore', 'Ng', 'Ortiz', 'Quinn', 'Reed', 'Shah', 'Turner',
  'Botha', 'Naidoo', 'Mokoena', 'Petersen', 'Khumalo', 'Viljoen', 'Chetty', 'Dlamini', 'Jacobs', 'Steyn',
];

type DatePlan = {
  entityType: 'production' | 'activity' | 'contact' | 'case' | 'goal' | 'user_mobile' | 'case_document';
  rowId: string;
  bucket: DemoDateBucket;
  slot: number;
};

const slugLocal = (first: string, last: string): string =>
  `${first}.${last}`.toLowerCase().replace(/[^a-z0-9.]+/g, '.').replace(/^\.+|\.+$/g, '');

const contactName = (seed: number): { first: string; last: string } => ({
  first: FIRST_NAMES[seed % FIRST_NAMES.length],
  last: LAST_NAMES[Math.floor(seed / FIRST_NAMES.length) % LAST_NAMES.length],
});

const isoDaysFromToday = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function seedNorthstarCommercial(
  client: pg.PoolClient,
  input: { companyId: string; execId: string; execEmail: string; packageId: string }
): Promise<void> {
  const pkg = await client.query<{ name: string; slug: string; price_cents: number }>(
    `SELECT name, slug, price_cents FROM subscription_packages WHERE id = $1`,
    [input.packageId]
  );
  const plan = pkg.rows[0];
  if (!plan) throw new Error('Northstar commercial seed requires a Pro package');

  const nextBilling = new Date();
  nextBilling.setUTCMonth(nextBilling.getUTCMonth() + 1, 1);
  nextBilling.setUTCHours(0, 0, 0, 0);

  await client.query(
    `INSERT INTO company_subscriptions (
       company_id, status, package_id, started_at, next_billing_at,
       vat_registered, vat_rate_percent, billing_contact_user_id,
       billing_contact_name, billing_contact_email
     ) VALUES ($1, 'active', $2, NOW() - INTERVAL '11 months', $3, TRUE, 15, $4, $5, $6)
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
    [
      input.companyId,
      input.packageId,
      nextBilling.toISOString(),
      input.execId,
      `${NORTHSTAR_PERSONAS.executive.firstName} ${NORTHSTAR_PERSONAS.executive.lastName}`,
      input.execEmail,
    ]
  );

  await client.query(
    `INSERT INTO company_billing_profiles (
       company_id, registered_name, trading_name, registration_number,
       vat_registered, vat_number, vat_rate_percent, billing_contact_name,
       billing_email, telephone, address, city, province, postal_code, country
     ) VALUES (
       $1, 'Northstar Advisory (Pty) Ltd', 'Northstar Advisory', '2021/448821/07',
       TRUE, '4123456789', 15, $2, $3, '000 000 1000',
       '12 Harbour View, Foreshore', 'Cape Town', 'Western Cape', '8001', 'South Africa'
     )
     ON CONFLICT (company_id) DO UPDATE SET
       registered_name = EXCLUDED.registered_name,
       trading_name = EXCLUDED.trading_name,
       billing_contact_name = EXCLUDED.billing_contact_name,
       billing_email = EXCLUDED.billing_email`,
    [
      input.companyId,
      `${NORTHSTAR_PERSONAS.executive.firstName} ${NORTHSTAR_PERSONAS.executive.lastName}`,
      input.execEmail,
    ]
  );

  const line = calculateLine({
    description: `AdvisorTrack ${plan.name} licences (${NORTHSTAR_SEAT_LIMIT} seats)`,
    quantity: NORTHSTAR_SEAT_LIMIT,
    unitPriceCents: Number(plan.price_cents),
    discountCents: 0,
    vatRatePercent: DEFAULT_VAT_RATE_PERCENT,
  });
  const totals = calculateInvoiceTotals([line]);

  const invoices: Array<{
    status: 'paid' | 'sent';
    invoiceDate: string;
    dueDate: string;
    paymentDate: string | null;
    issuedOffsetHours: number;
  }> = [
    {
      status: 'paid',
      invoiceDate: isoDaysFromToday(-45),
      dueDate: isoDaysFromToday(-15),
      paymentDate: isoDaysFromToday(-15),
      issuedOffsetHours: 45 * 24,
    },
    {
      status: 'sent',
      invoiceDate: isoDaysFromToday(-5),
      dueDate: isoDaysFromToday(25),
      paymentDate: null,
      issuedOffsetHours: 5 * 24,
    },
    {
      status: 'sent',
      invoiceDate: isoDaysFromToday(-40),
      dueDate: isoDaysFromToday(-10),
      paymentDate: null,
      issuedOffsetHours: 40 * 24,
    },
  ];
  if (invoices.length !== NORTHSTAR_INVOICE_COUNT) {
    throw new Error(`Expected ${NORTHSTAR_INVOICE_COUNT} Northstar invoices`);
  }

  for (const invoice of invoices) {
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
         paid_at, payment_date, issued_at, created_by_user_id
       ) VALUES (
         $1,$2,$3,$4,$5,$6, NULL, 'Fictional Northstar demo invoice. No live billing.',
         'Payment due within 30 days.', 'ZAR',
         'Northstar Advisory (Pty) Ltd', 'Northstar Advisory', '2021/448821/07',
         TRUE, '4123456789', $7, $8, '000 000 1000',
         '12 Harbour View, Foreshore', 'Cape Town', 'Western Cape', '8001', 'South Africa',
         $9, $10, $11, $12, $13, $14, $15, $16, $17
       ) RETURNING id`,
      [
        input.companyId,
        seq,
        invoiceNumber,
        invoice.status,
        invoice.invoiceDate,
        invoice.dueDate,
        `${NORTHSTAR_PERSONAS.executive.firstName} ${NORTHSTAR_PERSONAS.executive.lastName}`,
        input.execEmail,
        plan.slug,
        plan.name,
        totals.subtotalCents,
        totals.vatCents,
        totals.totalCents,
        invoice.paymentDate ? `${invoice.paymentDate}T12:00:00Z` : null,
        invoice.paymentDate,
        new Date(Date.now() - invoice.issuedOffsetHours * 3600 * 1000).toISOString(),
        input.execId,
      ]
    );
    await client.query(
      `INSERT INTO invoice_line_items (
         invoice_id, sort_order, description, quantity, unit_price_cents, discount_cents,
         vat_rate_percent, line_subtotal_cents, line_vat_cents, line_total_cents, is_current
       ) VALUES ($1, 0, $2, $3, $4, 0, $5, $6, $7, $8, TRUE)`,
      [
        inserted.rows[0].id,
        line.description,
        line.quantity,
        line.unitPriceCents,
        line.vatRatePercent,
        line.lineSubtotalCents,
        line.lineVatCents,
        line.lineTotalCents,
      ]
    );
    await client.query(
      `INSERT INTO invoice_status_events (invoice_id, from_status, to_status, actor_user_id, note)
       VALUES ($1, NULL, 'draft', $2, 'Created'),
              ($1, 'draft', 'sent', $2, 'Issued')`,
      [inserted.rows[0].id, input.execId]
    );
    if (invoice.status === 'paid') {
      await client.query(
        `INSERT INTO invoice_status_events (invoice_id, from_status, to_status, actor_user_id, note)
         VALUES ($1, 'sent', 'paid', $2, 'Settled')`,
        [inserted.rows[0].id, input.execId]
      );
    }
  }
}

async function archiveCompanyEmails(
  client: pg.PoolClient,
  companyId: string,
  marker: string
): Promise<void> {
  await client.query(
    `UPDATE users
     SET email = regexp_replace(email, '@', '.' || $2 || '@'),
         is_active = FALSE,
         updated_at = NOW()
     WHERE company_id = $1
       AND email NOT LIKE ('%.' || $2 || '@%')`,
    [companyId, marker]
  );
}

async function archiveTemplate(
  client: pg.PoolClient,
  companyId: string,
  marker: string
): Promise<void> {
  await client.query(
    `UPDATE demo_workspace_templates
     SET status = 'archived'
     WHERE company_id = $1 AND status = 'active'`,
    [companyId]
  );
  await client.query(
    `UPDATE demo_company_personas
     SET status = 'archived'
     WHERE company_id = $1 AND status = 'active'`,
    [companyId]
  );
  await client.query(`UPDATE companies SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [
    companyId,
  ]);
  await client.query(
    `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE company_id = $1`,
    [companyId]
  );
  await archiveCompanyEmails(client, companyId, marker);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const identity = await client.query<{ db: string }>(`SELECT current_database() AS db`);
    if (identity.rows[0]?.db !== DEMO_DB) {
      console.error(`Refusing Northstar seed: connected to "${identity.rows[0]?.db}", expected "${DEMO_DB}".`);
      process.exit(1);
    }

    const counts = countNorthstarPeople();
    const force = process.env.FORCE_NORTHSTAR_RESEED === '1';

    await client.query('BEGIN');

    await client.query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW()
       WHERE email = 'john.mitchell@advisortrack.com' AND COALESCE(is_active, TRUE) = TRUE`
    );

    const active = await client.query<{ company_id: string; seed_version: number }>(
      `SELECT company_id, seed_version
       FROM demo_workspace_templates
       WHERE status = 'active'
       LIMIT 1`
    );
    if (active.rows[0] && active.rows[0].seed_version >= NORTHSTAR_SEED_VERSION && !force) {
      const people = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1`,
        [active.rows[0].company_id]
      );
      const cases = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM client_cases c
         INNER JOIN users u ON u.id = c.user_id
         WHERE u.company_id = $1`,
        [active.rows[0].company_id]
      );
      if ((people.rows[0]?.n ?? 0) >= 50 && (cases.rows[0]?.n ?? 0) >= 360) {
        await client.query('COMMIT');
        console.log(
          `Northstar master template already active (${people.rows[0].n} users, ${cases.rows[0].n} cases). Skipping.`
        );
        return;
      }
    }

    if (active.rows[0]?.company_id === PHASE11_TEMPLATE_COMPANY_ID || active.rows[0]) {
      const marker =
        active.rows[0].company_id === PHASE11_TEMPLATE_COMPANY_ID
          ? 'archived-phase11'
          : `archived-v${active.rows[0].seed_version}-${Date.now().toString(36)}`;
      await archiveTemplate(client, active.rows[0].company_id, marker);
      console.log(`Archived previous demo template ${active.rows[0].company_id} (${marker}).`);
    }

    const existingPhase11 = await client.query(
      `SELECT 1 FROM companies WHERE id = $1`,
      [PHASE11_TEMPLATE_COMPANY_ID]
    );
    if (existingPhase11.rowCount) {
      await archiveTemplate(client, PHASE11_TEMPLATE_COMPANY_ID, 'archived-phase11');
    }

    let companyId = NORTHSTAR_COMPANY_ID;
    const taken = await client.query(`SELECT 1 FROM companies WHERE id = $1`, [companyId]);
    if (taken.rowCount) {
      companyId = crypto.randomUUID();
    }

    const slugTaken = await client.query(`SELECT 1 FROM companies WHERE slug = $1`, [
      NORTHSTAR_TEMPLATE_SLUG,
    ]);
    const slug = slugTaken.rowCount
      ? `${NORTHSTAR_TEMPLATE_SLUG}-${crypto.randomBytes(3).toString('hex')}`
      : NORTHSTAR_TEMPLATE_SLUG;

    await client.query(
      `INSERT INTO companies (id, name, slug, seat_limit, is_platform, is_active)
       VALUES ($1, $2, $3, $4, FALSE, TRUE)`,
      [companyId, NORTHSTAR_COMPANY_NAME, slug, NORTHSTAR_SEAT_LIMIT]
    );

    const roleIds: Record<string, string> = {
      Executive: crypto.randomUUID(),
      'Regional Manager': crypto.randomUUID(),
      'Team Leader': crypto.randomUUID(),
      'Financial Advisor': crypto.randomUUID(),
    };
    await client.query(
      `INSERT INTO company_roles (id, company_id, name, is_default, is_system)
       VALUES
         ($2, $1, 'Executive', FALSE, TRUE),
         ($3, $1, 'Regional Manager', FALSE, TRUE),
         ($4, $1, 'Team Leader', FALSE, TRUE),
         ($5, $1, 'Financial Advisor', TRUE, TRUE)`,
      [companyId, roleIds.Executive, roleIds['Regional Manager'], roleIds['Team Leader'], roleIds['Financial Advisor']]
    );
    await client.query(
      `INSERT INTO company_role_permissions (role_id, permission_key)
       SELECT $1, key FROM UNNEST(ARRAY['view_company','view_team','manage_roles','manage_members','manage_company']) AS key`,
      [roleIds.Executive]
    );
    await client.query(
      `INSERT INTO company_role_permissions (role_id, permission_key)
       SELECT $1, key FROM UNNEST(ARRAY['view_team','manage_members']) AS key`,
      [roleIds['Regional Manager']]
    );
    await client.query(
      `INSERT INTO company_role_permissions (role_id, permission_key)
       SELECT $1, key FROM UNNEST(ARRAY['view_team','manage_members']) AS key`,
      [roleIds['Team Leader']]
    );

    const execId = crypto.randomUUID();
    const insertUser = async (input: {
      id: string;
      first: string;
      last: string;
      roleName: string;
      roleId: string;
      reportsTo: string | null;
      phone: string;
    }) => {
      await client.query(
        `INSERT INTO users (
           id, first_name, last_name, email, phone, company, role, password_hash,
           company_id, company_role_id, reports_to_user_id, is_platform_admin,
           is_active, email_verified_at, completed_guided_tour
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,FALSE,NOW(),TRUE)`,
        [
          input.id,
          input.first,
          input.last,
          northstarEmail(input.first, input.last),
          input.phone,
          NORTHSTAR_COMPANY_NAME,
          input.roleName,
          NORTHSTAR_PASSWORD_HASH,
          companyId,
          input.roleId,
          input.reportsTo,
        ]
      );
    };

    await insertUser({
      id: execId,
      first: NORTHSTAR_PERSONAS.executive.firstName,
      last: NORTHSTAR_PERSONAS.executive.lastName,
      roleName: 'Executive',
      roleId: roleIds.Executive,
      reportsTo: null,
      phone: '000 000 1000',
    });

    const packages = await client.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM subscription_packages WHERE slug IN ('pro','free')`
    );
    const proId = packages.rows.find((row) => row.slug === 'pro')?.id;
    const freeId = packages.rows.find((row) => row.slug === 'free')?.id;
    if (!proId || !freeId) {
      throw new Error('subscription_packages pro/free missing from advisortrack_demo');
    }

    const assignLicence = async (userId: string, licensed: boolean) => {
      await client.query(
        `INSERT INTO user_subscriptions (user_id, package_id, status, started_at, updated_at)
         VALUES ($1, $2, 'active', NOW(), NOW())`,
        [userId, licensed ? proId : freeId]
      );
    };
    await assignLicence(execId, true);

    const datePlans: DatePlan[] = [];
    let phoneSeq = 2000;
    let contactSeq = 0;
    let advisorIndex = 0;
    let caseCount = 0;
    let productionCount = 0;

    const insertContactCaseProduction = async (input: {
      advisorId: string;
      bucket: DatePlan['bucket'];
      slot: number;
      title: string;
      amount: number;
      issued: boolean;
      stage: (typeof STAGES)[number];
      status: 'open' | 'won';
      product: string;
      docsReceived?: 0 | 1 | 2 | 3;
      ficaId?: boolean;
      ficaResidence?: boolean;
      ficaBank?: boolean;
      nextAction?: boolean;
      nextActionTitle?: string;
    }) => {
      const won = input.status === 'won';
      const docsReceived = input.docsReceived ?? (won ? 3 : 3);
      const ficaId = input.ficaId ?? won;
      const ficaResidence = input.ficaResidence ?? won;
      const ficaBank = input.ficaBank ?? won;
      const nextAction = input.nextAction ?? false;
      const contact = contactName(contactSeq++);
      const contactId = crypto.randomUUID();
      const caseId = crypto.randomUUID();
      await client.query(
        `INSERT INTO contacts (
           id, user_id, first_name, last_name, email, phone, company, status, priority, rating, interests, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'medium',3.5, ARRAY[$9]::product_tag[], $10)`,
        [
          contactId,
          input.advisorId,
          contact.first,
          contact.last,
          `${slugLocal(contact.first, contact.last)}.${contactSeq}.${input.slot}@client.${NORTHSTAR_EMAIL_DOMAIN}`,
          `000 ${String(phoneSeq++).padStart(3, '0')} ${String(contactSeq).padStart(4, '0')}`.slice(0, 30),
          NORTHSTAR_COMPANY_NAME,
          won ? 'active' : 'prospect',
          input.product,
          'Fictional Northstar demo contact.',
        ]
      );
      datePlans.push({ entityType: 'contact', rowId: contactId, bucket: input.bucket, slot: input.slot });

      await client.query(
        `INSERT INTO client_cases (
           id, user_id, contact_id, current_stage, status, title, estimated_commission,
           quote_product_type, quote_premium, fica_id_received, fica_residence_received,
           fica_bank_received, next_step_date
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          caseId,
          input.advisorId,
          contactId,
          input.stage,
          input.status,
          input.title,
          input.amount || 18500,
          input.product,
          Math.round((input.amount || 18500) / 12),
          ficaId,
          ficaResidence,
          ficaBank,
          nextAction ? '2020-06-01' : null,
        ]
      );
      datePlans.push({ entityType: 'case', rowId: caseId, bucket: input.bucket, slot: input.slot });
      caseCount += 1;

      for (const [docIndex, document] of CASE_DOCUMENTS.entries()) {
        const documentId = crypto.randomUUID();
        const received = docIndex < docsReceived;
        await client.query(
          `INSERT INTO case_documents (id, case_id, document_type, label, sent_at, received_at, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            documentId,
            caseId,
            document.documentType,
            document.label,
            received || docsReceived > 0 ? new Date('2020-01-10T08:00:00Z') : null,
            received ? new Date('2020-01-12T08:00:00Z') : null,
            'Fictional Northstar demo document.',
          ]
        );
        datePlans.push({
          entityType: 'case_document',
          rowId: documentId,
          bucket: input.bucket,
          slot: input.slot + docIndex,
        });
      }

      if (nextAction) {
        const activityId = crypto.randomUUID();
        await client.query(
          `INSERT INTO activities (
             id, user_id, contact_id, case_id, title, pipeline_stage, status, tags, notes, legacy_type, duration_minutes
           ) VALUES ($1,$2,$3,$4,$5,$6,'scheduled', ARRAY[$7]::product_tag[], $8, 'meeting', 30)`,
          [
            activityId,
            input.advisorId,
            contactId,
            caseId,
            input.nextActionTitle ?? 'Call client',
            input.stage,
            input.product,
            'Fictional Northstar demo next action.',
          ]
        );
        datePlans.push({
          entityType: 'activity',
          rowId: activityId,
          bucket: 'upcoming',
          slot: input.slot,
        });
      }

      if (input.amount > 0) {
        const productionId = crypto.randomUUID();
        await client.query(
          `INSERT INTO production_entries (
             id, user_id, contact_id, title, pipeline_stage, entry_type, tags, amount, product_name, notes,
             is_issued, issued_at, application_status, case_id
           ) VALUES ($1,$2,$3,$4,$5,'commission', ARRAY[$6]::product_tag[], $7,$6,$8,$9,$10,$11,$12)`,
          [
            productionId,
            input.advisorId,
            contactId,
            input.title,
            input.stage,
            input.product,
            input.amount,
            'Fictional Northstar demo production.',
            input.issued,
            input.issued ? new Date('2020-01-15T08:00:00Z') : null,
            input.issued ? 'accepted_issued' : 'pending_underwriting',
            caseId,
          ]
        );
        await client.query(`UPDATE client_cases SET linked_production_id = $2 WHERE id = $1`, [
          caseId,
          productionId,
        ]);
        datePlans.push({
          entityType: 'production',
          rowId: productionId,
          bucket: input.bucket,
          slot: input.slot,
        });
        productionCount += 1;
      }

      return caseId;
    };

    const insertActivity = async (
      advisorId: string,
      bucket: DatePlan['bucket'],
      slot: number,
      title: string,
      status: 'scheduled' | 'completed'
    ) => {
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO activities (id, user_id, title, pipeline_stage, status, tags, notes, legacy_type, duration_minutes)
         VALUES ($1,$2,$3,'Interview',$4, ARRAY['Life Cover']::product_tag[], $5, $6, 30)`,
        [
          id,
          advisorId,
          title,
          status,
          'Fictional Northstar demo activity.',
          status === 'completed' ? 'call' : 'meeting',
        ]
      );
      datePlans.push({ entityType: 'activity', rowId: id, bucket, slot });
    };

    for (const [regionIndex, region] of NORTHSTAR_REGIONS.entries()) {
      const rmId = crypto.randomUUID();
      await insertUser({
        id: rmId,
        first: region.manager.firstName,
        last: region.manager.lastName,
        roleName: 'Regional Manager',
        roleId: roleIds['Regional Manager'],
        reportsTo: execId,
        phone: `000 000 ${1100 + regionIndex}`,
      });
      await assignLicence(rmId, true);

      const regionId = crypto.randomUUID();
      await client.query(
        `INSERT INTO regions (id, company_id, name, manager_user_id, is_active)
         VALUES ($1,$2,$3,$4,TRUE)`,
        [regionId, companyId, region.name, rmId]
      );

      for (const [teamIndex, team] of region.teams.entries()) {
        const tlId = crypto.randomUUID();
        await insertUser({
          id: tlId,
          first: team.leader.firstName,
          last: team.leader.lastName,
          roleName: 'Team Leader',
          roleId: roleIds['Team Leader'],
          reportsTo: rmId,
          phone: `000 000 ${1200 + regionIndex * 10 + teamIndex}`,
        });
        await assignLicence(tlId, true);

        const teamRowId = crypto.randomUUID();
        await client.query(
          `INSERT INTO teams (id, company_id, region_id, name, leader_user_id, is_active)
           VALUES ($1,$2,$3,$4,$5,TRUE)`,
          [teamRowId, companyId, regionId, team.name, tlId]
        );

        for (const [faIndex, advisor] of team.advisors.entries()) {
          const faId = crypto.randomUUID();
          await insertUser({
            id: faId,
            first: advisor.firstName,
            last: advisor.lastName,
            roleName: 'Financial Advisor',
            roleId: roleIds['Financial Advisor'],
            reportsTo: tlId,
            phone: `000 000 ${1300 + advisorIndex}`,
          });
          await assignLicence(faId, advisor.licensed);

          const product = PRODUCTS[advisorIndex % PRODUCTS.length];
          const currentIssued = currentMonthIssuedFor(advisor.archetype, advisorIndex);
          const currentPending = 28_500 + ((advisorIndex * 910) % 24_000);
          const lastWeekIssued = 17_850 + (advisorIndex % 9) * 620;
          const ytdIssued = 52_000 + ((advisorIndex * 2_100) % 45_000);
          const openDocsComplete = advisor.archetype !== 'missing_docs';

          await insertContactCaseProduction({
            advisorId: faId,
            bucket: 'last_month',
            slot: advisorIndex * 3 + faIndex,
            title: `${product} issued case`,
            amount: advisor.lastMonthIssued,
            issued: true,
            stage: 'Implementation',
            status: 'won',
            product,
          });
          await insertContactCaseProduction({
            advisorId: faId,
            bucket: 'current_month',
            slot: advisorIndex,
            title: `${product} this-month issued`,
            amount: currentIssued,
            issued: true,
            stage: 'Implementation',
            status: 'won',
            product,
          });
          await insertContactCaseProduction({
            advisorId: faId,
            bucket: 'current_month',
            slot: advisorIndex + 20,
            title: `${product} awaiting underwriting`,
            amount: currentPending,
            issued: false,
            stage: 'Recommendation',
            status: 'open',
            product,
            docsReceived: openDocsComplete ? 3 : 1,
            ficaId: true,
            ficaResidence: openDocsComplete,
            ficaBank: openDocsComplete,
            nextAction: advisor.archetype !== 'stalled' && advisor.archetype !== 'mixed',
            nextActionTitle: 'Follow up underwriting',
          });
          await insertContactCaseProduction({
            advisorId: faId,
            bucket: 'last_week',
            slot: advisorIndex,
            title: `${product} last-week issued`,
            amount: lastWeekIssued,
            issued: true,
            stage: 'Implementation',
            status: 'won',
            product,
          });
          await insertContactCaseProduction({
            advisorId: faId,
            bucket: 'year_to_date',
            slot: advisorIndex,
            title: `${product} earlier this year`,
            amount: ytdIssued,
            issued: true,
            stage: 'Review',
            status: 'won',
            product,
          });
          await insertContactCaseProduction({
            advisorId: faId,
            bucket: advisor.archetype === 'stalled' ? 'stale_7' : 'current_month',
            slot: advisorIndex + 40,
            title: `${STAGES[advisorIndex % 4]} pipeline`,
            amount: 0,
            issued: false,
            stage: STAGES[advisorIndex % 4],
            status: 'open',
            product,
            docsReceived: openDocsComplete ? 3 : 2,
            ficaId: true,
            ficaResidence: true,
            ficaBank: openDocsComplete,
            nextAction: advisor.archetype !== 'stalled' && advisor.archetype !== 'mixed',
            nextActionTitle: 'Call client',
          });

          for (const extra of extraCasesFor(advisor.archetype, advisorIndex, product)) {
            await insertContactCaseProduction({
              advisorId: faId,
              bucket: extra.bucket,
              slot: advisorIndex * 11 + extra.slotOffset,
              title: extra.title,
              amount: extra.amount,
              issued: extra.issued,
              stage: extra.stage,
              status: 'open',
              product,
              docsReceived: extra.docsReceived,
              ficaId: extra.ficaId,
              ficaResidence: extra.ficaResidence,
              ficaBank: extra.ficaBank,
              nextAction: extra.nextAction,
              nextActionTitle: extra.nextActionTitle,
            });
          }

          await insertActivity(faId, 'last_week', advisorIndex, 'Follow-up call', 'completed');
          await insertActivity(faId, 'current_month', advisorIndex, 'Review meeting', 'scheduled');

          const mobileBucket = mobileBucketFor(advisor.archetype, advisorIndex);
          if (mobileBucket) {
            datePlans.push({
              entityType: 'user_mobile',
              rowId: faId,
              bucket: mobileBucket,
              slot: advisorIndex,
            });
          }

          const extraProspect = contactName(contactSeq++);
          const extraId = crypto.randomUUID();
          await client.query(
            `INSERT INTO contacts (id, user_id, first_name, last_name, email, phone, status, priority, interests, notes)
             VALUES ($1,$2,$3,$4,$5,$6,'prospect','low', ARRAY['Savings']::product_tag[], 'Fictional unused prospect.')`,
            [
              extraId,
              faId,
              extraProspect.first,
              extraProspect.last,
              `${slugLocal(extraProspect.first, extraProspect.last)}.p${contactSeq}@client.${NORTHSTAR_EMAIL_DOMAIN}`,
              `000 ${String(phoneSeq++).padStart(3, '0')} 0000`,
            ]
          );
          datePlans.push({
            entityType: 'contact',
            rowId: extraId,
            bucket: 'older',
            slot: advisorIndex,
          });

          const goalId = crypto.randomUUID();
          await client.query(
            `INSERT INTO production_monthly_goals (id, user_id, month, goal_amount)
             VALUES ($1,$2, DATE_TRUNC('month', NOW())::date, $3)`,
            [goalId, faId, 80_000 + (advisorIndex % 5) * 15_000]
          );
          datePlans.push({ entityType: 'goal', rowId: goalId, bucket: 'current_month', slot: 0 });

          advisorIndex += 1;
        }
      }
    }

    const execPersona = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND email = $2`,
      [companyId, northstarEmail(NORTHSTAR_PERSONAS.executive.firstName, NORTHSTAR_PERSONAS.executive.lastName)]
    );
    const rmPersona = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND email = $2`,
      [
        companyId,
        northstarEmail(
          NORTHSTAR_PERSONAS.regional_manager.firstName,
          NORTHSTAR_PERSONAS.regional_manager.lastName
        ),
      ]
    );
    const tlPersona = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE company_id = $1 AND email = $2`,
      [companyId, northstarEmail(NORTHSTAR_PERSONAS.team_leader.firstName, NORTHSTAR_PERSONAS.team_leader.lastName)]
    );

    await client.query(
      `INSERT INTO demo_company_personas (company_id, role, user_id, status)
       VALUES
         ($1, 'executive', $2, 'active'),
         ($1, 'regional_manager', $3, 'active'),
         ($1, 'team_leader', $4, 'active')`,
      [companyId, execPersona.rows[0].id, rmPersona.rows[0].id, tlPersona.rows[0].id]
    );

    await client.query(
      `INSERT INTO demo_workspace_templates (company_id, status, seed_version, version_label)
       VALUES ($1, 'active', $2, $3)`,
      [companyId, NORTHSTAR_SEED_VERSION, NORTHSTAR_VERSION_LABEL]
    );

    for (const plan of datePlans) {
      await client.query(
        `INSERT INTO demo_seed_date_plan (template_company_id, entity_type, template_row_id, bucket, slot)
         VALUES ($1,$2,$3,$4,$5)`,
        [companyId, plan.entityType, plan.rowId, plan.bucket, plan.slot]
      );
    }

    const licensed = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM users u
       INNER JOIN user_subscriptions us ON us.user_id = u.id
       INNER JOIN subscription_packages p ON p.id = us.package_id
       WHERE u.company_id = $1 AND us.status IN ('active','trialing') AND p.slug <> 'free'`,
      [companyId]
    );

    if (licensed.rows[0].n !== NORTHSTAR_ASSIGNED_LICENCES) {
      throw new Error(`Expected ${NORTHSTAR_ASSIGNED_LICENCES} licensed seats, got ${licensed.rows[0].n}`);
    }
    if (advisorIndex !== counts.advisors) {
      throw new Error(`Expected ${counts.advisors} advisors, inserted ${advisorIndex}`);
    }

    await seedNorthstarCommercial(client, {
      companyId,
      execId,
      execEmail: northstarEmail(NORTHSTAR_PERSONAS.executive.firstName, NORTHSTAR_PERSONAS.executive.lastName),
      packageId: proId,
    });

    await client.query('COMMIT');
    console.log(
      `Northstar master seeded: company ${companyId}, ${counts.executives + counts.regionalManagers + counts.teamLeaders + counts.advisors} users, ${caseCount} cases, ${productionCount} production rows, licensed ${licensed.rows[0].n}/${NORTHSTAR_SEAT_LIMIT}.`
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
