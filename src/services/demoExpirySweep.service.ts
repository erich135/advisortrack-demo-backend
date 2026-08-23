import { getPool } from '../config/database';
import { env } from '../config/env';
import { demoSessionRepository } from '../repositories/demoSession.repository';
import { createLogger } from '../utils/logger';

const log = createLogger('DemoExpirySweep');

/**
 * Marks expired active demo sessions expired and deactivates their visitor
 * companies. Idempotent. Never deletes. Never touches templates or production.
 */
export const sweepExpiredDemoSessions = async (
  now: Date = new Date()
): Promise<{ expiredSessions: number; deactivatedCompanies: number }> => {
  if (!env.isDemoMode) {
    return { expiredSessions: 0, deactivatedCompanies: 0 };
  }

  const expired = await demoSessionRepository.expireActivePast(now);
  if (expired.length === 0) {
    return { expiredSessions: 0, deactivatedCompanies: 0 };
  }

  const companyIds = [...new Set(expired.map((row) => row.company_id).filter(Boolean))] as string[];
  if (companyIds.length === 0) {
    return { expiredSessions: expired.length, deactivatedCompanies: 0 };
  }

  const result = await getPool().query<{ id: string }>(
    `UPDATE companies c
     SET is_active = FALSE, updated_at = NOW()
     WHERE c.id = ANY($1::uuid[])
       AND c.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM demo_workspace_templates t WHERE t.company_id = c.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM demo_sessions s
         WHERE s.company_id = c.id
           AND s.status = 'active'
           AND s.expires_at > $2
       )
     RETURNING c.id`,
    [companyIds, now]
  );

  log.info('Expired demo sessions swept', {
    expiredSessions: expired.length,
    deactivatedCompanies: result.rowCount ?? result.rows.length,
  });

  return {
    expiredSessions: expired.length,
    deactivatedCompanies: result.rowCount ?? result.rows.length,
  };
};
