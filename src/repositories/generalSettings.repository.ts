import { getPool } from '../config/database';

export interface GeneralSettings {
  userId: string;
  avgCommissionOverride: boolean;
  avgCommissionAmount: number;
  taxDirectiveOverride: boolean;
  taxRatePercent: number;
  coldCallToInterviewOverride: boolean;
  coldCallToInterviewRatio: number;
  interviewToAnalysisOverride: boolean;
  interviewToAnalysisRatio: number;
  analysisToRecommendationOverride: boolean;
  analysisToRecommendationRatio: number;
  recommendationToImplementationOverride: boolean;
  recommendationToImplementationRatio: number;
  submissionToIssuedOverride: boolean;
  submissionToIssuedRatio: number;
  adaptiveRatiosEnabled: boolean;
  ratiosLastAdjustedAt?: string;
  ratiosAdjustmentMonth?: string;
  createdAt: string;
  updatedAt: string;
}

interface GeneralSettingsRow {
  user_id: string;
  avg_commission_override: boolean;
  avg_commission_amount: string;
  tax_directive_override: boolean;
  tax_rate_percent: string;
  cold_call_to_interview_override: boolean;
  cold_call_to_interview_ratio: string;
  interview_to_analysis_override: boolean;
  interview_to_analysis_ratio: string;
  analysis_to_recommendation_override: boolean;
  analysis_to_recommendation_ratio: string;
  recommendation_to_implementation_override: boolean;
  recommendation_to_implementation_ratio: string;
  submission_to_issued_override: boolean;
  submission_to_issued_ratio: string;
  adaptive_ratios_enabled: boolean;
  ratios_last_adjusted_at: Date | null;
  ratios_adjustment_month: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `
  user_id,
  avg_commission_override,
  avg_commission_amount,
  tax_directive_override,
  tax_rate_percent,
  cold_call_to_interview_override,
  cold_call_to_interview_ratio,
  interview_to_analysis_override,
  interview_to_analysis_ratio,
  analysis_to_recommendation_override,
  analysis_to_recommendation_ratio,
  recommendation_to_implementation_override,
  recommendation_to_implementation_ratio,
  submission_to_issued_override,
  submission_to_issued_ratio,
  adaptive_ratios_enabled,
  ratios_last_adjusted_at,
  ratios_adjustment_month,
  created_at,
  updated_at
`;

/**
 * Maps a PostgreSQL advisor_general_settings row to the application type.
 */
const mapRow = (row: GeneralSettingsRow): GeneralSettings => ({
  userId: row.user_id,
  avgCommissionOverride: row.avg_commission_override,
  avgCommissionAmount: Number(row.avg_commission_amount),
  taxDirectiveOverride: row.tax_directive_override,
  taxRatePercent: Number(row.tax_rate_percent),
  coldCallToInterviewOverride: row.cold_call_to_interview_override,
  coldCallToInterviewRatio: Number(row.cold_call_to_interview_ratio),
  interviewToAnalysisOverride: row.interview_to_analysis_override,
  interviewToAnalysisRatio: Number(row.interview_to_analysis_ratio),
  analysisToRecommendationOverride: row.analysis_to_recommendation_override,
  analysisToRecommendationRatio: Number(row.analysis_to_recommendation_ratio),
  recommendationToImplementationOverride: row.recommendation_to_implementation_override,
  recommendationToImplementationRatio: Number(row.recommendation_to_implementation_ratio),
  submissionToIssuedOverride: row.submission_to_issued_override,
  submissionToIssuedRatio: Number(row.submission_to_issued_ratio),
  adaptiveRatiosEnabled: row.adaptive_ratios_enabled ?? true,
  ratiosLastAdjustedAt: row.ratios_last_adjusted_at?.toISOString(),
  ratiosAdjustmentMonth: row.ratios_adjustment_month ?? undefined,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const DEFAULT_SETTINGS: Omit<GeneralSettings, 'userId' | 'createdAt' | 'updatedAt'> = {
  avgCommissionOverride: false,
  avgCommissionAmount: 10000,
  taxDirectiveOverride: false,
  taxRatePercent: 23,
  coldCallToInterviewOverride: false,
  coldCallToInterviewRatio: 4,
  interviewToAnalysisOverride: false,
  interviewToAnalysisRatio: 6,
  analysisToRecommendationOverride: false,
  analysisToRecommendationRatio: 6,
  recommendationToImplementationOverride: false,
  recommendationToImplementationRatio: 6,
  submissionToIssuedOverride: false,
  submissionToIssuedRatio: 8,
  adaptiveRatiosEnabled: true,
};

/**
 * PostgreSQL persistence for advisor general settings (conversion ratios, tax, avg commission).
 */
export const generalSettingsRepository = {
  /**
   * Ensures a settings row exists for the user.
   */
  async ensureRow(userId: string): Promise<void> {
    await getPool().query(
      `INSERT INTO advisor_general_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
  },

  /**
   * Loads general settings for an advisor.
   */
  async findByUserId(userId: string): Promise<GeneralSettings> {
    await this.ensureRow(userId);

    const result = await getPool().query<GeneralSettingsRow>(
      `SELECT ${COLUMNS} FROM advisor_general_settings WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows[0]) {
      const now = new Date().toISOString();
      return { userId, ...DEFAULT_SETTINGS, createdAt: now, updatedAt: now };
    }

    return mapRow(result.rows[0]);
  },

  /**
   * Partially updates general settings fields.
   */
  async patch(
    userId: string,
    input: Partial<Omit<GeneralSettings, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<GeneralSettings> {
    await this.ensureRow(userId);

    const fieldMap: Record<string, string> = {
      avgCommissionOverride: 'avg_commission_override',
      avgCommissionAmount: 'avg_commission_amount',
      taxDirectiveOverride: 'tax_directive_override',
      taxRatePercent: 'tax_rate_percent',
      coldCallToInterviewOverride: 'cold_call_to_interview_override',
      coldCallToInterviewRatio: 'cold_call_to_interview_ratio',
      interviewToAnalysisOverride: 'interview_to_analysis_override',
      interviewToAnalysisRatio: 'interview_to_analysis_ratio',
      analysisToRecommendationOverride: 'analysis_to_recommendation_override',
      analysisToRecommendationRatio: 'analysis_to_recommendation_ratio',
      recommendationToImplementationOverride: 'recommendation_to_implementation_override',
      recommendationToImplementationRatio: 'recommendation_to_implementation_ratio',
      submissionToIssuedOverride: 'submission_to_issued_override',
      submissionToIssuedRatio: 'submission_to_issued_ratio',
      adaptiveRatiosEnabled: 'adaptive_ratios_enabled',
      ratiosLastAdjustedAt: 'ratios_last_adjusted_at',
      ratiosAdjustmentMonth: 'ratios_adjustment_month',
    };

    const sets: string[] = [];
    const values: unknown[] = [userId];
    let param = 2;

    for (const [key, column] of Object.entries(fieldMap)) {
      const val = input[key as keyof typeof input];
      if (val !== undefined) {
        sets.push(`${column} = $${param++}`);
        values.push(val);
      }
    }

    if (sets.length === 0) {
      return this.findByUserId(userId);
    }

    sets.push('updated_at = NOW()');

    const result = await getPool().query<GeneralSettingsRow>(
      `UPDATE advisor_general_settings SET ${sets.join(', ')} WHERE user_id = $1 RETURNING ${COLUMNS}`,
      values
    );

    return mapRow(result.rows[0]);
  },
};
