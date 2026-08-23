import { getPool } from '../config/database';
import { CreateActivityInput, UpdateActivityInput } from '../validators/schemas';
import { Activity, ActivityType } from '../types';
import { createLogger } from '../utils/logger';

const log = createLogger('activityRepository');

const PIPELINE_STAGES = [
  'Initial Contact',
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review',
] as const;

const STAGE_TO_TYPE: Record<string, ActivityType> = {
  'Initial Contact': 'call',
  Interview: 'meeting',
  Analysis: 'follow_up',
  Recommendation: 'presentation',
  Implementation: 'other',
  Review: 'follow_up',
};

const TYPE_TO_STAGE: Record<ActivityType, string> = {
  call: 'Initial Contact',
  meeting: 'Interview',
  email: 'Initial Contact',
  follow_up: 'Analysis',
  presentation: 'Recommendation',
  other: 'Implementation',
};

interface ActivityRow {
  id: string;
  user_id: string;
  contact_id: string | null;
  title: string | null;
  pipeline_stage: string | null;
  status: string;
  outcome: string | null;
  lost_reason: string | null;
  source_activity_id: string | null;
  due_date: Date | null;
  due_time: string | null;
  due_at: Date | null;
  notes: string | null;
  legacy_type: string | null;
  duration_minutes: number | null;
  created_at: Date;
  contact_first_name: string | null;
  contact_last_name: string | null;
}

export interface ActivityRecord extends Omit<Activity, 'contactName'> {
  userId: string;
  contactName?: string;
}

/**
 * Resolves pipeline stage from explicit input, title prefix, or legacy type mapping.
 */
const resolvePipelineStage = (input: CreateActivityInput): string => {
  if (input.pipelineStage) {
    return input.pipelineStage;
  }

  for (const stage of PIPELINE_STAGES) {
    if (input.title.startsWith(stage)) {
      return stage;
    }
  }

  return TYPE_TO_STAGE[input.type] ?? 'Initial Contact';
};

/**
 * Maps pipeline stage or legacy type to the mobile API activity type enum.
 */
const resolveActivityType = (row: ActivityRow): ActivityType => {
  if (row.legacy_type && row.legacy_type in TYPE_TO_STAGE) {
    return row.legacy_type as ActivityType;
  }
  if (row.pipeline_stage && row.pipeline_stage in STAGE_TO_TYPE) {
    return STAGE_TO_TYPE[row.pipeline_stage];
  }
  return 'other';
};

/**
 * Builds an ISO scheduledAt from PostgreSQL date/time columns.
 */
const buildScheduledAt = (row: ActivityRow): string => {
  if (row.due_at) {
    return row.due_at.toISOString();
  }

  if (row.due_date) {
    const scheduled = new Date(row.due_date);
    if (row.due_time) {
      const [hours, minutes, seconds] = row.due_time.split(':').map(Number);
      scheduled.setHours(hours ?? 0, minutes ?? 0, seconds ?? 0, 0);
    } else {
      scheduled.setHours(9, 0, 0, 0);
    }
    return scheduled.toISOString();
  }

  return row.created_at.toISOString();
};

/**
 * Maps a joined activities row to the public API Activity DTO.
 */
const mapActivityRow = (row: ActivityRow): ActivityRecord => {
  const contactName = [row.contact_first_name, row.contact_last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title?.trim() || row.pipeline_stage || 'Activity',
    type: resolveActivityType(row),
    status: row.status as Activity['status'],
    pipelineStage: row.pipeline_stage ?? undefined,
    outcome: (row.outcome as Activity['outcome']) ?? undefined,
    lostReason: row.lost_reason ?? undefined,
    sourceActivityId: row.source_activity_id ?? undefined,
    contactId: row.contact_id ?? undefined,
    contactName: contactName || undefined,
    description: row.notes ?? undefined,
    scheduledAt: buildScheduledAt(row),
    durationMinutes: row.duration_minutes ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
};

const ACTIVITY_SELECT = `
  SELECT
    a.id,
    a.user_id,
    a.contact_id,
    a.title,
    a.pipeline_stage::text AS pipeline_stage,
    a.status::text AS status,
    a.outcome::text AS outcome,
    a.lost_reason,
    a.source_activity_id,
    a.due_date,
    a.due_time::text AS due_time,
    a.due_at,
    a.notes,
    a.legacy_type,
    a.duration_minutes,
    a.created_at,
    c.first_name AS contact_first_name,
    c.last_name AS contact_last_name
  FROM activities a
  LEFT JOIN contacts c ON c.id = a.contact_id
`;

/**
 * PostgreSQL persistence for advisor activities.
 */
export const activityRepository = {
  /**
   * Counts activities belonging to an advisor (setup completion checklist).
   */
  async countByUserId(userId: string): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM activities WHERE user_id = $1',
      [userId]
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  /**
   * Lists activities for a user, optionally filtered by calendar date (YYYY-MM-DD).
   */
  async listByUserId(userId: string, dateFilter?: string): Promise<ActivityRecord[]> {
    const params: unknown[] = [userId];
    let dateClause = '';

    if (dateFilter?.trim()) {
      params.push(dateFilter.trim());
      dateClause = `
        AND (
          a.due_at::date = $2::date
          OR a.due_date = $2::date
        )
      `;
    }

    const result = await getPool().query<ActivityRow>(
      `${ACTIVITY_SELECT}
       WHERE a.user_id = $1
       ${dateClause}
       ORDER BY COALESCE(a.due_at, a.due_date, a.created_at) ASC`,
      params
    );

    return result.rows.map(mapActivityRow);
  },

  /**
   * Counts completed activities per pipeline stage within a date range (adaptive ratios).
   */
  async countCompletedByStageBetween(
    userId: string,
    startDate: string,
    endDate: string
  ): Promise<Record<string, number>> {
    const result = await getPool().query<{ pipeline_stage: string; count: string }>(
      `SELECT pipeline_stage::text, COUNT(*)::text AS count
       FROM activities
       WHERE user_id = $1
         AND status = 'completed'
         AND (outcome IS NULL OR outcome != 'lost')
         AND COALESCE(due_date, created_at::date) >= $2::date
         AND COALESCE(due_date, created_at::date) < $3::date
       GROUP BY pipeline_stage`,
      [userId, startDate, endDate]
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[row.pipeline_stage] = Number(row.count);
    }
    return counts;
  },

  /**
   * Inserts a new activity linked to a contact and scheduled datetime.
   */
  async create(userId: string, input: CreateActivityInput): Promise<ActivityRecord> {
    const scheduled = new Date(input.scheduledAt);
    const pipelineStage = resolvePipelineStage(input);
    const contactId =
      input.contactId && /^[0-9a-f-]{36}$/i.test(input.contactId) ? input.contactId : null;

    const insertParams = {
      userId,
      contactId,
      title: input.title.trim(),
      pipelineStage,
      status: input.status,
      dueAt: scheduled.toISOString(),
      dueDate: scheduled.toISOString().slice(0, 10),
      dueTime: `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}:00`,
      type: input.type,
    };

    log.info('Inserting activity', insertParams);

    if (Number.isNaN(scheduled.getTime())) {
      log.error('Invalid scheduledAt datetime', {
        userId,
        scheduledAt: input.scheduledAt,
      });
      throw new Error(`Invalid scheduledAt: ${input.scheduledAt}`);
    }

    try {
      const result = await getPool().query<ActivityRow>(
      `INSERT INTO activities (
         user_id,
         contact_id,
         title,
         pipeline_stage,
         status,
         due_at,
         due_date,
         due_time,
         notes,
         legacy_type,
         duration_minutes
       )
       VALUES (
         $1,
         $2,
         $3,
         $4::pipeline_stage,
         $5::activity_status,
         $6,
         $7::date,
         $8::time,
         $9,
         $10,
         $11
       )
       RETURNING
         id,
         user_id,
         contact_id,
         title,
         pipeline_stage::text AS pipeline_stage,
         status::text AS status,
         due_date,
         due_time::text AS due_time,
         due_at,
         notes,
         legacy_type,
         duration_minutes,
         created_at,
         NULL::text AS contact_first_name,
         NULL::text AS contact_last_name`,
      [
        userId,
        contactId,
        input.title.trim(),
        pipelineStage,
        input.status,
        scheduled.toISOString(),
        scheduled.toISOString().slice(0, 10),
        `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}:00`,
        input.description?.trim() || null,
        input.type,
        input.durationMinutes ?? null,
      ]
    );

    const created = result.rows[0];
    log.info('Activity inserted', {
      userId,
      activityId: created.id,
      pipelineStage: created.pipeline_stage,
      dueAt: created.due_at?.toISOString(),
      dueDate: created.due_date,
    });

    if (contactId) {
      const withContact = await getPool().query<ActivityRow>(
        `${ACTIVITY_SELECT} WHERE a.id = $1 LIMIT 1`,
        [created.id]
      );
      return mapActivityRow(withContact.rows[0]);
    }

    return mapActivityRow(created);
    } catch (error) {
      log.error('Activity insert failed', {
        userId,
        insertParams,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },

  /**
   * Loads a single activity when it belongs to the given advisor.
   */
  async findByIdForUser(userId: string, activityId: string): Promise<ActivityRecord | null> {
    const result = await getPool().query<ActivityRow>(
      `${ACTIVITY_SELECT} WHERE a.id = $1 AND a.user_id = $2 LIMIT 1`,
      [activityId, userId]
    );
    const row = result.rows[0];
    return row ? mapActivityRow(row) : null;
  },

  /**
   * Lists scheduled activities from now onward (dashboard upcoming events).
   */
  async listUpcoming(userId: string, limit = 5): Promise<ActivityRecord[]> {
    const result = await getPool().query<ActivityRow>(
      `${ACTIVITY_SELECT}
       WHERE a.user_id = $1
         AND a.status = 'scheduled'
         AND COALESCE(a.due_at, a.due_date::timestamp, a.created_at) >= NOW()
       ORDER BY COALESCE(a.due_at, a.due_date::timestamp, a.created_at) ASC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapActivityRow);
  },

  /**
   * Partially updates activity status, notes, or title for the owning advisor.
   */
  async update(
    userId: string,
    activityId: string,
    input: UpdateActivityInput
  ): Promise<ActivityRecord | null> {
    const sets: string[] = [];
    const params: unknown[] = [activityId, userId];

    if (input.status !== undefined) {
      params.push(input.status);
      sets.push(`status = $${params.length}::activity_status`);
    }
    if (input.description !== undefined) {
      params.push(input.description.trim() || null);
      sets.push(`notes = $${params.length}`);
    }
    if (input.title !== undefined) {
      params.push(input.title.trim());
      sets.push(`title = $${params.length}`);
    }
    if (input.scheduledAt !== undefined) {
      const scheduled = new Date(input.scheduledAt);
      if (Number.isNaN(scheduled.getTime())) {
        throw new Error(`Invalid scheduledAt: ${input.scheduledAt}`);
      }
      const dueDate = scheduled.toISOString().slice(0, 10);
      const dueTime = `${String(scheduled.getHours()).padStart(2, '0')}:${String(
        scheduled.getMinutes()
      ).padStart(2, '0')}:00`;
      params.push(scheduled.toISOString());
      sets.push(`due_at = $${params.length}`);
      params.push(dueDate);
      sets.push(`due_date = $${params.length}::date`);
      params.push(dueTime);
      sets.push(`due_time = $${params.length}::time`);
    }

    if (sets.length === 0) {
      return this.findByIdForUser(userId, activityId);
    }

    const result = await getPool().query<{ id: string }>(
      `UPDATE activities
       SET ${sets.join(', ')}
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      params
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.findByIdForUser(userId, activityId);
  },

  /**
   * Marks an activity completed with a pipeline outcome (proceeded, lost, completed).
   */
  async setOutcome(
    userId: string,
    activityId: string,
    input: { outcome: Activity['outcome']; lostReason?: string }
  ): Promise<ActivityRecord | null> {
    const result = await getPool().query<{ id: string }>(
      `UPDATE activities
       SET status = 'completed',
           outcome = $3::activity_outcome,
           lost_reason = $4
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [activityId, userId, input.outcome, input.lostReason?.trim() || null]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.findByIdForUser(userId, activityId);
  },

  /**
   * Permanently removes an activity owned by the advisor.
   */
  async delete(userId: string, activityId: string): Promise<boolean> {
    const result = await getPool().query<{ id: string }>(
      `DELETE FROM activities
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [activityId, userId]
    );
    return Boolean(result.rows[0]);
  },

  /**
   * Creates or updates the next scheduled activity when Proceed advances a stage.
   * De-dupes on contact + stage + scheduled status so pipeline sync cannot spawn card clones.
   */
  async createFromPipeline(
    userId: string,
    input: {
      title: string;
      pipelineStage: string;
      contactId?: string;
      contactName?: string;
      description?: string;
      scheduledAt: string;
      sourceActivityId: string;
      caseId?: string;
    }
  ): Promise<ActivityRecord> {
    const scheduled = new Date(input.scheduledAt);
    const contactId =
      input.contactId && /^[0-9a-f-]{36}$/i.test(input.contactId) ? input.contactId : null;
    const legacyType = STAGE_TO_TYPE[input.pipelineStage] ?? 'other';
    const dueDate = scheduled.toISOString().slice(0, 10);
    const dueTime = `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}:00`;

    let existingId: string | undefined;
    if (contactId) {
      const existing = await getPool().query<{ id: string }>(
        `SELECT id
         FROM activities
         WHERE user_id = $1
           AND contact_id = $2
           AND pipeline_stage = $3::pipeline_stage
           AND status = 'scheduled'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, contactId, input.pipelineStage]
      );
      existingId = existing.rows[0]?.id;
    }

    if (existingId) {
      await getPool().query(
        `UPDATE activities
         SET title = $3,
             due_at = $4,
             due_date = $5::date,
             due_time = $6::time,
             notes = COALESCE($7, notes),
             legacy_type = $8,
             source_activity_id = $9,
             case_id = COALESCE($10::uuid, case_id),
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [
          existingId,
          userId,
          input.title.trim(),
          scheduled.toISOString(),
          dueDate,
          dueTime,
          input.description?.trim() || null,
          legacyType,
          input.sourceActivityId,
          input.caseId ?? null,
        ]
      );
      const updated = await this.findByIdForUser(userId, existingId);
      if (!updated) {
        throw new Error('Failed to load updated pipeline activity');
      }
      return updated;
    }

    const result = await getPool().query<{ id: string }>(
      `INSERT INTO activities (
         user_id,
         contact_id,
         case_id,
         title,
         pipeline_stage,
         status,
         due_at,
         due_date,
         due_time,
         notes,
         legacy_type,
         source_activity_id
       )
       VALUES (
         $1, $2, $3, $4, $5::pipeline_stage, 'scheduled', $6, $7::date, $8::time, $9, $10, $11
       )
       RETURNING id`,
      [
        userId,
        contactId,
        input.caseId ?? null,
        input.title.trim(),
        input.pipelineStage,
        scheduled.toISOString(),
        dueDate,
        dueTime,
        input.description?.trim() || null,
        legacyType,
        input.sourceActivityId,
      ]
    );

    const created = await this.findByIdForUser(userId, result.rows[0].id);
    if (!created) {
      throw new Error('Failed to load created pipeline activity');
    }
    return created;
  },

  /**
   * Creates or updates the scheduled pipeline activity for a case stage (prevents duplicates on save).
   */
  async upsertScheduledForCase(
    userId: string,
    input: {
      caseId: string;
      contactId: string;
      pipelineStage: string;
      title: string;
      scheduledAt: string;
      description?: string;
    }
  ): Promise<void> {
    const scheduled = new Date(input.scheduledAt);
    if (Number.isNaN(scheduled.getTime())) {
      throw new Error(`Invalid scheduledAt: ${input.scheduledAt}`);
    }

    const legacyType = STAGE_TO_TYPE[input.pipelineStage] ?? 'follow_up';
    const dueDate = scheduled.toISOString().slice(0, 10);
    const dueTime = `${String(scheduled.getHours()).padStart(2, '0')}:${String(scheduled.getMinutes()).padStart(2, '0')}:00`;

    const existing = await getPool().query<{ id: string }>(
      `SELECT id
       FROM activities
       WHERE user_id = $1
         AND case_id = $2
         AND pipeline_stage = $3::pipeline_stage
         AND status = 'scheduled'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, input.caseId, input.pipelineStage]
    );

    if (existing.rows[0]) {
      await getPool().query(
        `UPDATE activities
         SET title = $3,
             contact_id = $4,
             due_at = $5,
             due_date = $6::date,
             due_time = $7::time,
             notes = $8,
             legacy_type = $9
         WHERE id = $1 AND user_id = $2`,
        [
          existing.rows[0].id,
          userId,
          input.title.trim(),
          input.contactId,
          scheduled.toISOString(),
          dueDate,
          dueTime,
          input.description?.trim() || null,
          legacyType,
        ]
      );
      return;
    }

    await getPool().query(
      `INSERT INTO activities (
         user_id,
         contact_id,
         case_id,
         title,
         pipeline_stage,
         status,
         due_at,
         due_date,
         due_time,
         notes,
         legacy_type
       )
       VALUES ($1, $2, $3, $4, $5::pipeline_stage, 'scheduled', $6, $7::date, $8::time, $9, $10)`,
      [
        userId,
        input.contactId,
        input.caseId,
        input.title.trim(),
        input.pipelineStage,
        scheduled.toISOString(),
        dueDate,
        dueTime,
        input.description?.trim() || null,
        legacyType,
      ]
    );
  },

  /**
   * Returns the due_at ISO string for the scheduled activity linked to a case stage.
   */
  async findScheduledDueAtForCase(
    userId: string,
    caseId: string,
    pipelineStage: string
  ): Promise<string | undefined> {
    const result = await getPool().query<{ due_at: Date | null }>(
      `SELECT due_at
       FROM activities
       WHERE user_id = $1
         AND case_id = $2
         AND pipeline_stage = $3::pipeline_stage
         AND status = 'scheduled'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, caseId, pipelineStage]
    );
    const dueAt = result.rows[0]?.due_at;
    return dueAt ? dueAt.toISOString() : undefined;
  },
};
