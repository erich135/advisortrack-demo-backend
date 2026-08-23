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
  };

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
      await client.query(
        `UPDATE activities
         SET due_date = $2::date,
             due_at = $3::timestamptz,
             created_at = $3::timestamptz,
             updated_at = $3::timestamptz
         WHERE id = $1`,
        [newId, ymd, at.toISOString()]
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
         SET created_at = $2::timestamptz,
             updated_at = $2::timestamptz
         WHERE id = $1`,
        [newId, at.toISOString()]
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
    }
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
