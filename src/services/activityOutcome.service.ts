import { getPool } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { activityRepository } from '../repositories/activity.repository';
import { caseRepository } from '../repositories/case.repository';
import { contactRepository } from '../repositories/contact.repository';
import { productionRepository } from '../repositories/production.repository';
import { ActivityOutcomeInput, CreateProductionInput } from '../validators/schemas';
import {
  getNextPipelineStage,
  getPipelineStageLabel,
  isCaseLinkStage,
  PIPELINE_STAGES,
} from './pipelineStages';
import { Activity } from '../types';

export interface ActivityOutcomeResult {
  activity: Omit<Activity, 'userId'>;
  nextActivity?: Omit<Activity, 'userId'>;
  production?: Awaited<ReturnType<typeof productionRepository.create>>;
}

const OUTCOME_MAP = {
  proceed: 'proceeded',
  lost: 'lost',
  complete: 'completed',
} as const;

/**
 * Resolves pipeline stage from stored stage or legacy activity type.
 */
const resolveStage = (pipelineStage: string | null | undefined, legacyType: string): string => {
  if (pipelineStage && PIPELINE_STAGES.includes(pipelineStage as (typeof PIPELINE_STAGES)[number])) {
    return pipelineStage;
  }
  const typeToStage: Record<string, string> = {
    call: 'Initial Contact',
    meeting: 'Interview',
    email: 'Initial Contact',
    follow_up: 'Analysis',
    presentation: 'Recommendation',
    other: 'Implementation',
  };
  return typeToStage[legacyType] ?? 'Initial Contact';
};

/**
 * Builds a default scheduled datetime one day ahead at 11:00.
 */
const defaultNextScheduledAt = (): string => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(11, 0, 0, 0);
  return next.toISOString();
};

/**
 * Creates a linked production case when the advisor supplies estimate details.
 */
const maybeCreateProduction = async (
  userId: string,
  activityId: string,
  stage: string,
  existing: Activity,
  productionInput: NonNullable<ActivityOutcomeInput['production']>
) => {
  if (!isCaseLinkStage(stage)) {
    return undefined;
  }

  const contactLabel = existing.contactName ?? existing.title;
  const payload: CreateProductionInput = {
    title: `${getPipelineStageLabel(stage)} — ${contactLabel}`,
    type: 'commission',
    amount: productionInput.amount,
    contactId: existing.contactId,
    contactName: existing.contactName,
    pipelineStage: stage as CreateProductionInput['pipelineStage'],
    date: productionInput.date,
    isIssued: productionInput.isIssued ?? false,
    notes: productionInput.notes,
    sourceActivityId: activityId,
    tags: [],
  };

  return productionRepository.create(userId, payload);
};

/**
 * Advances an open client case to the target pipeline stage when one exists.
 * Falls back to the most recently updated case for the contact if none is open
 * (e.g. edge states after submit-to-production).
 */
const syncOpenCaseStage = async (
  userId: string,
  contactId: string | undefined,
  targetStage: string
): Promise<void> => {
  if (!contactId) {
    return;
  }
  let openCase = await caseRepository.findOpenByContact(userId, contactId);
  if (!openCase) {
    openCase = await caseRepository.findLatestByContact(userId, contactId);
  }
  if (openCase) {
    await caseRepository.update(userId, openCase.id, {
      currentStage: targetStage,
      status: 'open',
    });
  }
};

/**
 * Records a pipeline outcome on an activity — proceed, lost, or complete without advancing.
 */
export const recordActivityOutcome = async (
  userId: string,
  activityId: string,
  input: ActivityOutcomeInput
): Promise<ActivityOutcomeResult> => {
  const existing = await activityRepository.findByIdForUser(userId, activityId);
  if (!existing) {
    throw new AppError(404, 'Activity not found', 'NOT_FOUND');
  }

  if (existing.status === 'completed' && existing.outcome) {
    throw new AppError(409, 'Activity outcome already recorded', 'OUTCOME_EXISTS');
  }

  const dbOutcome = OUTCOME_MAP[input.action];
  const stage = resolveStage(existing.pipelineStage, existing.type);

  const updated = await activityRepository.setOutcome(userId, activityId, {
    outcome: dbOutcome,
    lostReason: input.lostReason,
  });

  if (!updated) {
    throw new AppError(404, 'Activity not found', 'NOT_FOUND');
  }

  const { userId: _uid, ...activityDto } = updated;
  const result: ActivityOutcomeResult = { activity: activityDto };

  if (input.action === 'lost' && existing.contactId) {
    await contactRepository.update(userId, existing.contactId, { status: 'inactive' });
  }

  if (input.production) {
    const production = await maybeCreateProduction(
      userId,
      activityId,
      stage,
      existing,
      input.production
    );
    if (production) {
      result.production = production;
    }
  }

  if (input.action === 'proceed') {
    const nextStage = input.nextPipelineStage ?? getNextPipelineStage(stage);
    if (!nextStage) {
      throw new AppError(400, 'No next pipeline stage after Review', 'NO_NEXT_STAGE');
    }

    const contactLabel = existing.contactName ?? existing.title;
    const openCase = existing.contactId
      ? (await caseRepository.findOpenByContact(userId, existing.contactId)) ??
        (await caseRepository.findLatestByContact(userId, existing.contactId))
      : null;

    const created = await activityRepository.createFromPipeline(userId, {
      title: `${getPipelineStageLabel(nextStage)} — ${contactLabel}`,
      pipelineStage: nextStage,
      contactId: existing.contactId,
      contactName: existing.contactName,
      scheduledAt: input.nextScheduledAt ?? defaultNextScheduledAt(),
      sourceActivityId: activityId,
      caseId: openCase?.id,
    });

    await syncOpenCaseStage(userId, existing.contactId, nextStage);

    if (openCase && input.nextScheduledAt) {
      const dateOnly = input.nextScheduledAt.slice(0, 10);
      await caseRepository.update(userId, openCase.id, {
        nextStepDate: dateOnly,
      });
    }

    const { userId: _nuid, ...nextDto } = created;
    result.nextActivity = nextDto;
  }

  if (input.action === 'complete' && input.advanceCase && existing.contactId) {
    const nextStage = getNextPipelineStage(stage);
    if (nextStage) {
      await syncOpenCaseStage(userId, existing.contactId, nextStage);
    }
  }

  return result;
};

/**
 * Aggregates pipeline conversion and lost ratios for the current calendar month.
 */
export const getPipelineAnalytics = async (userId: string) => {
  const pool = getPool();
  const monthStart = await pool.query<{ month_start: Date; month_end: Date }>(
    `SELECT
       DATE_TRUNC('month', CURRENT_DATE)::date AS month_start,
       (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::date AS month_end`
  );
  const { month_start: start, month_end: end } = monthStart.rows[0];

  const result = await pool.query<{
    pipeline_stage: string;
    outcome: string;
    count: string;
  }>(
    `SELECT pipeline_stage::text, outcome::text, COUNT(*)::text AS count
     FROM activities
     WHERE user_id = $1
       AND status = 'completed'
       AND outcome IS NOT NULL
       AND COALESCE(due_date, created_at::date) >= $2::date
       AND COALESCE(due_date, created_at::date) < $3::date
     GROUP BY pipeline_stage, outcome`,
    [userId, start, end]
  );

  const stages = PIPELINE_STAGES.map((stageName) => {
    const rows = result.rows.filter((row) => row.pipeline_stage === stageName);
    const proceeded = Number(rows.find((r) => r.outcome === 'proceeded')?.count ?? 0);
    const lost = Number(rows.find((r) => r.outcome === 'lost')?.count ?? 0);
    const completed = Number(rows.find((r) => r.outcome === 'completed')?.count ?? 0);
    const closed = proceeded + lost;
    const conversionPercent = closed > 0 ? Math.round((proceeded / closed) * 100) : 0;
    const lostPercent = closed > 0 ? Math.round((lost / closed) * 100) : 0;

    return {
      stage: stageName,
      proceeded,
      lost,
      completed,
      conversionPercent,
      lostPercent,
    };
  });

  const totalProceeded = stages.reduce((sum, row) => sum + row.proceeded, 0);
  const totalLost = stages.reduce((sum, row) => sum + row.lost, 0);
  const closedTotal = totalProceeded + totalLost;

  return {
    period: {
      month: start.toISOString().slice(0, 10),
    },
    stages,
    overall: {
      totalProceeded,
      totalLost,
      lostRatio: closedTotal > 0 ? Math.round((totalLost / closedTotal) * 100) : 0,
      conversionRatio: closedTotal > 0 ? Math.round((totalProceeded / closedTotal) * 100) : 0,
    },
  };
};
