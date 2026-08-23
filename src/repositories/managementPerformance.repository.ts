import { getPool } from '../config/database';
import { BUSINESS_TIMEZONE } from '../features/performancePeriod';

/**
 * Issued production totals keyed by advisor, filtered by issued_at calendar date.
 */
export const managementPerformanceRepository = {
  /**
   * Sums issued Rand value per advisor using issued_at in the business timezone.
   * Records that are issued but have a null issued_at are excluded.
   */
  async sumIssuedByUser(
    userIds: string[],
    startDate: string,
    endDate: string
  ): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (userIds.length === 0) return totals;

    const result = await getPool().query<{ user_id: string; issued_amount: string }>(
      `SELECT
         pe.user_id,
         COALESCE(SUM(pe.amount), 0)::text AS issued_amount
       FROM production_entries pe
       WHERE pe.user_id = ANY($1::uuid[])
         AND (pe.is_issued OR pe.application_status = 'accepted_issued')
         AND pe.issued_at IS NOT NULL
         AND (pe.issued_at AT TIME ZONE $4)::date >= $2::date
         AND (pe.issued_at AT TIME ZONE $4)::date <= $3::date
       GROUP BY pe.user_id`,
      [userIds, startDate, endDate, BUSINESS_TIMEZONE]
    );

    for (const row of result.rows) {
      totals.set(row.user_id, Number(row.issued_amount));
    }
    return totals;
  },
};
