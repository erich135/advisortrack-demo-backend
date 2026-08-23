import { getPool } from '../config/database';

export interface FinancialProfile {
  userId: string;
  monthlyGoalNett?: number;
  monthlyDeductions?: number;
  commissionSplit?: string;
  commissionSplitNotes?: string;
  commissionAdvisorType?: string;
  workingWeeksPerYear?: number;
  workingDaysPerWeek?: number;
  vatRegistered?: boolean;
  vatRatePercent?: number;
  setupCompletedAt?: string;
  needsSetup: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FinancialProfileRow {
  user_id: string;
  monthly_goal_nett: string | null;
  monthly_deductions: string | null;
  commission_split: string | null;
  commission_split_notes: string | null;
  commission_advisor_type: string | null;
  working_weeks_per_year: number | null;
  working_days_per_week: number | null;
  vat_registered: boolean | null;
  vat_rate_percent: string | null;
  setup_completed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

let setupColumnExists: boolean | null = null;

/**
 * Checks whether migration 004 (setup_completed_at) has been applied.
 */
const hasSetupCompletedColumn = async (): Promise<boolean> => {
  if (setupColumnExists !== null) {
    return setupColumnExists;
  }

  const result = await getPool().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'advisor_financial_profile'
         AND column_name = 'setup_completed_at'
     ) AS exists`
  );

  setupColumnExists = result.rows[0]?.exists ?? false;
  return setupColumnExists;
};

/**
 * Maps a PostgreSQL advisor_financial_profile row to the application type.
 */
const mapRow = (row: FinancialProfileRow): FinancialProfile => ({
  userId: row.user_id,
  monthlyGoalNett: row.monthly_goal_nett != null ? Number(row.monthly_goal_nett) : undefined,
  monthlyDeductions: row.monthly_deductions != null ? Number(row.monthly_deductions) : undefined,
  commissionSplit: row.commission_split ?? undefined,
  commissionSplitNotes: row.commission_split_notes ?? undefined,
  commissionAdvisorType: row.commission_advisor_type ?? undefined,
  workingWeeksPerYear: row.working_weeks_per_year ?? 44,
  workingDaysPerWeek: row.working_days_per_week ?? 5,
  vatRegistered: row.vat_registered ?? false,
  vatRatePercent: row.vat_rate_percent != null ? Number(row.vat_rate_percent) : undefined,
  setupCompletedAt: row.setup_completed_at?.toISOString(),
  needsSetup: row.monthly_goal_nett == null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/**
 * Ensures a financial profile row exists for the user (trigger may have created it).
 */
const ensureRow = async (userId: string): Promise<void> => {
  await getPool().query(
    `INSERT INTO advisor_financial_profile (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
};

/**
 * PostgreSQL persistence for advisor financial profile (Profile Settings + setup concierge).
 */
export const financialProfileRepository = {
  /**
   * Loads the financial profile for a user.
   */
  async findByUserId(userId: string): Promise<FinancialProfile | null> {
    await ensureRow(userId);

    const withSetupCol = await hasSetupCompletedColumn();
    const setupSelect = withSetupCol ? 'setup_completed_at,' : '';

    const result = await getPool().query<FinancialProfileRow>(
      `SELECT user_id, monthly_goal_nett, monthly_deductions, commission_split,
              commission_split_notes, commission_advisor_type, working_weeks_per_year, working_days_per_week,
              vat_registered, vat_rate_percent,
              ${setupSelect} created_at, updated_at
       FROM advisor_financial_profile
       WHERE user_id = $1`,
      [userId]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  },

  /**
   * Partially updates financial profile fields (only provided fields are changed).
   */
  async patch(
    userId: string,
    input: {
      monthlyGoalNett?: number;
      monthlyDeductions?: number | null;
      commissionSplit?: string | null;
      commissionSplitNotes?: string | null;
      commissionAdvisorType?: string | null;
      workingWeeksPerYear?: number;
      workingDaysPerWeek?: number;
      vatRegistered?: boolean;
      vatRatePercent?: number | null;
    }
  ): Promise<FinancialProfile> {
    await ensureRow(userId);

    const sets: string[] = [];
    const values: unknown[] = [userId];
    let param = 2;

    if (input.monthlyGoalNett !== undefined) {
      sets.push(`monthly_goal_nett = $${param++}`);
      values.push(input.monthlyGoalNett);
    }
    if (input.monthlyDeductions !== undefined) {
      sets.push(`monthly_deductions = $${param++}`);
      values.push(input.monthlyDeductions);
    }
    if (input.commissionSplit !== undefined) {
      sets.push(`commission_split = $${param++}`);
      values.push(input.commissionSplit);
    }
    if (input.commissionSplitNotes !== undefined) {
      sets.push(`commission_split_notes = $${param++}`);
      values.push(input.commissionSplitNotes);
    }
    if (input.commissionAdvisorType !== undefined) {
      sets.push(`commission_advisor_type = $${param++}`);
      values.push(input.commissionAdvisorType);
    }
    if (input.workingWeeksPerYear !== undefined) {
      sets.push(`working_weeks_per_year = $${param++}`);
      values.push(input.workingWeeksPerYear);
    }
    if (input.workingDaysPerWeek !== undefined) {
      sets.push(`working_days_per_week = $${param++}`);
      values.push(input.workingDaysPerWeek);
    }
    if (input.vatRegistered !== undefined) {
      sets.push(`vat_registered = $${param++}`);
      values.push(input.vatRegistered);
    }
    if (input.vatRatePercent !== undefined) {
      sets.push(`vat_rate_percent = $${param++}`);
      values.push(input.vatRatePercent);
    }

    if (sets.length === 0) {
      const existing = await this.findByUserId(userId);
      if (!existing) {
        throw new Error('Financial profile not found');
      }
      return existing;
    }

    sets.push('updated_at = NOW()');

    const withSetupCol = await hasSetupCompletedColumn();
    const setupSelect = withSetupCol ? 'setup_completed_at,' : '';

    const result = await getPool().query<FinancialProfileRow>(
      `UPDATE advisor_financial_profile
       SET ${sets.join(', ')}
       WHERE user_id = $1
       RETURNING user_id, monthly_goal_nett, monthly_deductions, commission_split,
                 commission_split_notes, commission_advisor_type, working_weeks_per_year, working_days_per_week,
                 vat_registered, vat_rate_percent,
                 ${setupSelect} created_at, updated_at`,
      values
    );

    return mapRow(result.rows[0]);
  },

  /**
   * Marks setup concierge as complete and saves final financial targets.
   */
  async completeSetup(
    userId: string,
    input: {
      monthlyGoalNett: number;
      monthlyDeductions?: number | null;
      commissionSplit?: string | null;
      commissionSplitNotes?: string | null;
      commissionAdvisorType?: string | null;
      workingWeeksPerYear?: number;
      workingDaysPerWeek?: number;
    }
  ): Promise<FinancialProfile> {
    await ensureRow(userId);

    const withSetupCol = await hasSetupCompletedColumn();
    const setupSelect = withSetupCol ? 'setup_completed_at,' : '';
    const setupSet = withSetupCol ? 'setup_completed_at = NOW(),' : '';

    const result = await getPool().query<FinancialProfileRow>(
      `UPDATE advisor_financial_profile
       SET monthly_goal_nett = $2,
           monthly_deductions = $3,
           commission_split = $4,
           commission_split_notes = $5,
           commission_advisor_type = $6,
           working_weeks_per_year = $7,
           working_days_per_week = $8,
           ${setupSet}
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, monthly_goal_nett, monthly_deductions, commission_split,
                 commission_split_notes, commission_advisor_type, working_weeks_per_year, working_days_per_week,
                 vat_registered, vat_rate_percent,
                 ${setupSelect} created_at, updated_at`,
      [
        userId,
        input.monthlyGoalNett,
        input.monthlyDeductions ?? null,
        input.commissionSplit ?? null,
        input.commissionSplitNotes ?? null,
        input.commissionAdvisorType ?? null,
        input.workingWeeksPerYear ?? 44,
        input.workingDaysPerWeek ?? 5,
      ]
    );

    return mapRow(result.rows[0]);
  },
};
