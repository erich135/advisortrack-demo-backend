import { getPool } from '../config/database';
import { CreateContactInput } from '../validators/schemas';
import { caseService } from './case.service';
import { activityRepository } from '../repositories/activity.repository';
import { caseRepository } from '../repositories/case.repository';
import { productionRepository } from '../repositories/production.repository';
import {
  GRACE_PERIOD_DAYS,
  LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS,
} from '../features/subscriptionFeatures';

export type UserTier = 'sandbox' | 'live_preview' | 'pro' | 'grace';

export interface ContactQuota {
  practiceCount: number;
  activeRealCount: number;
  archivedRealCount: number;
  maxActiveRealContacts: number;
  canCreateRealContact: boolean;
  canImportContacts: boolean;
  livePreviewEnabled: boolean;
  sandboxCompleted: boolean;
}

export interface UserEntitlementsDto {
  tier: UserTier;
  livePreviewEnabled: boolean;
  sandboxCompleted: boolean;
  gracePeriodEndsAt?: string;
  graceDaysRemaining?: number;
  trialEndsAt?: string;
  trialDaysRemaining?: number;
  isPro: boolean;
  contacts: ContactQuota;
}

/**
 * Practice client templates seeded for new users (sandbox onboarding).
 */
export const PRACTICE_CONTACT_SEEDS: Array<CreateContactInput & { stageNote: string }> = [
  {
    firstName: 'Thabo',
    lastName: 'Molefe',
    email: 'practice.thabo@example.advisortrack',
    phone: '+27000000001',
    status: 'prospect',
    priority: 'medium',
    rating: 3,
    notes:
      'Sandbox client — step 1: Initial contact. Try scheduling a call and opening the pipeline case.',
    stageNote: 'Initial Contact',
  },
  {
    firstName: 'Lerato',
    lastName: 'Dlamini',
    email: 'practice.lerato@example.advisortrack',
    phone: '+27000000002',
    status: 'active',
    priority: 'high',
    rating: 4,
    notes:
      'Sandbox client — step 2: Fact-finding. Explore FICA checklist and short fact-find fields.',
    stageNote: 'Interview',
  },
  {
    firstName: 'Sipho',
    lastName: 'Nkosi',
    email: 'practice.demo@example.advisortrack',
    phone: '+27000000003',
    status: 'active',
    priority: 'high',
    rating: 5,
    notes:
      'Sandbox client — step 4: Recommendation. Try quote fields and estimated commission.',
    stageNote: 'Recommendation',
  },
];

/** Email fingerprint for the guided-tour demo client. */
export const TOUR_DEMO_CONTACT_EMAIL = 'tour.john.doe@example.advisortrack';

export interface TourDemoResult {
  contactId: string;
  created: boolean;
}

export interface TourFlywheelResult {
  contactId: string;
  caseId?: string;
  productionId?: string;
  createdContact: boolean;
}

/**
 * Ensures the single John Doe practice client exists for the guided tour sandbox.
 * Always creates him when missing — even if other practice clients already exist.
 */
export const ensureTourDemoContact = async (userId: string): Promise<TourDemoResult> => {
  const pool = getPool();

  const existingTour = await pool.query<{ id: string }>(
    `SELECT id FROM contacts WHERE user_id = $1 AND email = $2 LIMIT 1`,
    [userId, TOUR_DEMO_CONTACT_EMAIL]
  );
  if (existingTour.rows[0]) {
    return { contactId: existingTour.rows[0].id, created: false };
  }

  const result = await pool.query<{ id: string; first_name: string; last_name: string }>(
    `INSERT INTO contacts (
       user_id, first_name, last_name, email, phone, status, priority, rating, notes,
       is_practice, activation_status, import_source
     )
     VALUES ($1, 'John', 'Doe (Tour demo)', $2, '+27000000099', 'active', 'high', 5,
       'Guided tour sandbox client — explore pipeline, activities, and production here.',
       TRUE, 'active', 'manual')
     RETURNING id, first_name, last_name`,
    [userId, TOUR_DEMO_CONTACT_EMAIL]
  );

  const row = result.rows[0];
  const contactName = `${row.first_name} ${row.last_name}`.trim();
  await caseService.createForNewContact(userId, row.id, contactName);

  return { contactId: row.id, created: true };
};

/**
 * Seeds John Doe with a Life Cover case, appointment activity, and production draft for the flywheel tour.
 * Creates production via repository directly so tour prep never depends on compliance submit gates.
 */
export const prepareTourFlywheel = async (userId: string): Promise<TourFlywheelResult> => {
  const { contactId, created } = await ensureTourDemoContact(userId);
  const caseDto = await caseService.getOrCreateForContact(userId, contactId);

  await caseService.update(userId, caseDto.id, {
    quoteProductType: 'Life Cover',
    chosenInsurer: 'Sanlam',
    estimatedCommission: 4500,
    quotePremium: 850,
    currentStage: 'Recommendation',
  });

  let productionId = caseDto.linkedProductionId;
  if (!productionId) {
    const production = await productionRepository.create(userId, {
      title: 'Life Cover',
      type: 'commission',
      amount: 4500,
      contactId,
      contactName: 'John Doe',
      productName: 'Life Cover',
      pipelineStage: 'Recommendation',
      isIssued: false,
      applicationStatus: 'application_received',
      date: new Date().toISOString().slice(0, 10),
      notes: 'Provider: Sanlam',
      tags: [],
      caseId: caseDto.id,
    });
    productionId = production.id;
    await caseRepository.update(userId, caseDto.id, {
      linkedProductionId: productionId,
    });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const scheduledAt = `${tomorrow.toISOString().slice(0, 10)}T11:00:00.000Z`;

  await activityRepository.upsertScheduledForCase(userId, {
    caseId: caseDto.id,
    contactId,
    pipelineStage: 'Interview',
    title: 'Appointment Scheduled — John Doe',
    scheduledAt,
    description: 'Guided tour demo appointment',
  });

  return {
    contactId,
    caseId: caseDto.id,
    productionId,
    createdContact: created,
  };
};

/**
 * Marks the tour demo production as issued and promotes John Doe to Client.
 * Creates production directly when missing — avoids fragile submit-to-production paths that
 * can 500 mid-tour if compliance fields or prior state are incomplete.
 */
export const completeTourFlywheelIssue = async (
  userId: string
): Promise<{ productionId?: string; contactId: string }> => {
  const { contactId } = await ensureTourDemoContact(userId);
  const caseDto = await caseService.getOrCreateForContact(userId, contactId);

  let productionId = caseDto.linkedProductionId;

  if (!productionId) {
    const amount = caseDto.estimatedCommission ?? 4500;
    const contactName = caseDto.contactName?.trim() || 'John Doe';
    const production = await productionRepository.create(userId, {
      title: caseDto.quoteProductType?.trim() || 'Life Cover',
      type: 'commission',
      amount,
      contactId,
      contactName,
      productName: caseDto.quoteProductType ?? 'Life Cover',
      pipelineStage: 'Implementation',
      isIssued: false,
      applicationStatus: 'application_received',
      date: new Date().toISOString().slice(0, 10),
      notes: `Provider: ${caseDto.chosenInsurer ?? 'Sanlam'}`,
      tags: [],
      caseId: caseDto.id,
    });
    productionId = production.id;
    await caseRepository.update(userId, caseDto.id, {
      linkedProductionId: productionId,
      currentStage: 'Implementation',
      estimatedCommission: amount,
      quoteProductType: caseDto.quoteProductType ?? 'Life Cover',
      chosenInsurer: caseDto.chosenInsurer ?? 'Sanlam',
    });
  }

  if (productionId) {
    await productionRepository.update(userId, productionId, {
      isIssued: true,
      applicationStatus: 'accepted_issued',
    });
  }

  await getPool().query(
    `UPDATE contacts
     SET status = 'client',
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [contactId, userId]
  );

  return { productionId, contactId };
};

/**
 * Seeds practice contacts and open cases for sandbox onboarding.
 */
export const seedSandboxContacts = async (userId: string): Promise<number> => {
  const pool = getPool();

  const existing = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM contacts WHERE user_id = $1 AND is_practice = TRUE`,
    [userId]
  );

  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    return 0;
  }

  let created = 0;

  for (const seed of PRACTICE_CONTACT_SEEDS) {
    const { stageNote, ...input } = seed;
    const result = await pool.query<{ id: string; first_name: string; last_name: string }>(
      `INSERT INTO contacts (
         user_id, first_name, last_name, email, phone, status, priority, rating, notes,
         is_practice, activation_status, import_source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 'active', 'manual')
       RETURNING id, first_name, last_name`,
      [
        userId,
        input.firstName,
        input.lastName ?? '',
        input.email ?? null,
        input.phone ?? null,
        input.status,
        input.priority,
        input.rating,
        input.notes ?? null,
      ]
    );

    const row = result.rows[0];
    const contactName = `${row.first_name} ${row.last_name}`.trim();
    await caseService.createForNewContact(userId, row.id, contactName);

    if (stageNote !== 'Initial Contact') {
      await pool.query(
        `UPDATE client_cases SET current_stage = $3::pipeline_stage
         WHERE user_id = $1 AND contact_id = $2 AND status = 'open'`,
        [userId, row.id, stageNote]
      );
    }

    created += 1;
  }

  return created;
};

/**
 * Counts practice and real contacts by activation status.
 */
export const getContactQuota = async (userId: string): Promise<Omit<ContactQuota, 'canCreateRealContact' | 'canImportContacts' | 'livePreviewEnabled' | 'sandboxCompleted'>> => {
  const pool = getPool();
  const result = await pool.query<{
    practice_count: string;
    active_real_count: string;
    archived_real_count: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE is_practice = TRUE)::text AS practice_count,
       COUNT(*) FILTER (WHERE is_practice = FALSE AND activation_status = 'active')::text AS active_real_count,
       COUNT(*) FILTER (WHERE is_practice = FALSE AND activation_status = 'archived')::text AS archived_real_count
     FROM contacts
     WHERE user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  return {
    practiceCount: Number(row?.practice_count ?? 0),
    activeRealCount: Number(row?.active_real_count ?? 0),
    archivedRealCount: Number(row?.archived_real_count ?? 0),
    maxActiveRealContacts: LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS,
  };
};

/**
 * Archives real contacts beyond the Live Preview limit (keeps most recently updated).
 */
export const archiveExcessRealContacts = async (
  userId: string,
  keepCount = LIVE_PREVIEW_MAX_ACTIVE_REAL_CONTACTS
): Promise<number> => {
  const pool = getPool();

  const result = await pool.query<{ id: string }>(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (ORDER BY updated_at DESC NULLS LAST, created_at DESC) AS rn
       FROM contacts
       WHERE user_id = $1 AND is_practice = FALSE
     )
     UPDATE contacts c
     SET activation_status = CASE WHEN r.rn <= $2 THEN 'active' ELSE 'archived' END
     FROM ranked r
     WHERE c.id = r.id
     RETURNING c.id`,
    [userId, keepCount]
  );

  return result.rowCount ?? 0;
};

/**
 * Reactivates all real contacts when user upgrades to Pro.
 */
export const reactivateAllRealContacts = async (userId: string): Promise<void> => {
  await getPool().query(
    `UPDATE contacts SET activation_status = 'active'
     WHERE user_id = $1 AND is_practice = FALSE AND activation_status = 'archived'`,
    [userId]
  );
};

/**
 * Starts a grace period window after Pro payment lapses.
 */
export const startGracePeriod = async (userId: string): Promise<Date> => {
  const ends = new Date();
  ends.setDate(ends.getDate() + GRACE_PERIOD_DAYS);
  await getPool().query(
    `UPDATE user_subscriptions SET grace_period_ends_at = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, ends]
  );
  return ends;
};

/**
 * Clears grace period after successful renewal or upgrade.
 */
export const clearGracePeriod = async (userId: string): Promise<void> => {
  await getPool().query(
    `UPDATE user_subscriptions SET grace_period_ends_at = NULL, updated_at = NOW() WHERE user_id = $1`,
    [userId]
  );
};
