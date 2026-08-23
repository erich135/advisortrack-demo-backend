import { getPool } from '../config/database';
import { PipelineStage, DEFAULT_CASE_DOCUMENTS } from '../features/pipelineStages';

export type CaseStatus = 'open' | 'won' | 'lost' | 'closed';

export interface ClientCaseRow {
  id: string;
  user_id: string;
  contact_id: string;
  current_stage: string;
  status: string;
  title: string | null;
  fica_id_received: boolean;
  fica_residence_received: boolean;
  fica_bank_received: boolean;
  fica_skip_acknowledged: boolean;
  consent_sent_at: Date | null;
  fact_find_mode: string | null;
  simple_goal_product: string | null;
  simple_goal_amount: string | null;
  marital_status: string | null;
  dependents_notes: string | null;
  fixed_assets_total: string | null;
  non_fixed_assets_total: string | null;
  investments_total: string | null;
  liabilities_total: string | null;
  savings_monthly: string | null;
  employer_benefits_notes: string | null;
  business_interests_notes: string | null;
  retirement_funds_notes: string | null;
  life_cover_notes: string | null;
  estate_planning_notes: string | null;
  quotes_requested_notes: string | null;
  analysis_quotes: unknown;
  next_step_date: Date | null;
  stage_dates: unknown;
  monthly_income: string | null;
  monthly_expenses: string | null;
  financial_goals: string | null;
  risk_profile: string | null;
  fact_find_notes: string | null;
  quote_product_type: string | null;
  chosen_insurer: string | null;
  quote_premium: string | null;
  estimated_commission: string | null;
  replacement_advice_required: boolean;
  replacement_advice_confirmed: boolean;
  client_approved: boolean | null;
  review_due_at: Date | null;
  linked_production_id: string | null;
  created_at: Date;
  updated_at: Date;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
}

export interface CaseDocumentRow {
  id: string;
  case_id: string;
  document_type: string;
  label: string;
  sent_at: Date | null;
  received_at: Date | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

const CASE_SELECT = `
  c.id,
  c.user_id,
  c.contact_id,
  c.current_stage::text AS current_stage,
  c.status::text AS status,
  c.title,
  c.fica_id_received,
  c.fica_residence_received,
  c.fica_bank_received,
  c.fica_skip_acknowledged,
  c.consent_sent_at,
  c.fact_find_mode,
  c.simple_goal_product,
  c.simple_goal_amount,
  c.marital_status,
  c.dependents_notes,
  c.fixed_assets_total,
  c.non_fixed_assets_total,
  c.investments_total,
  c.liabilities_total,
  c.savings_monthly,
  c.employer_benefits_notes,
  c.business_interests_notes,
  c.retirement_funds_notes,
  c.life_cover_notes,
  c.estate_planning_notes,
  c.quotes_requested_notes,
  c.analysis_quotes,
  c.next_step_date,
  c.stage_dates,
  c.monthly_income,
  c.monthly_expenses,
  c.financial_goals,
  c.risk_profile,
  c.fact_find_notes,
  c.quote_product_type,
  c.chosen_insurer,
  c.quote_premium,
  c.estimated_commission,
  c.replacement_advice_required,
  c.replacement_advice_confirmed,
  c.client_approved,
  c.review_due_at,
  c.linked_production_id,
  c.created_at,
  c.updated_at,
  ct.first_name AS contact_first_name,
  ct.last_name AS contact_last_name
`;

/**
 * PostgreSQL persistence for client cases and compliance documents.
 */
export const caseRepository = {
  /**
   * Finds the open case for a contact, if any.
   */
  async findOpenByContact(userId: string, contactId: string): Promise<ClientCaseRow | null> {
    const result = await getPool().query<ClientCaseRow>(
      `SELECT ${CASE_SELECT}
       FROM client_cases c
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.user_id = $1 AND c.contact_id = $2 AND c.status = 'open'
       ORDER BY c.updated_at DESC
       LIMIT 1`,
      [userId, contactId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Finds the most recently updated case for a contact (any status).
   * Used when Proceed must advance a case that is no longer strictly open.
   */
  async findLatestByContact(userId: string, contactId: string): Promise<ClientCaseRow | null> {
    const result = await getPool().query<ClientCaseRow>(
      `SELECT ${CASE_SELECT}
       FROM client_cases c
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.user_id = $1 AND c.contact_id = $2
       ORDER BY c.updated_at DESC
       LIMIT 1`,
      [userId, contactId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Counts open pipeline cases for a contact (multi-case support).
   */
  async countOpenByContact(userId: string, contactId: string): Promise<number> {
    const result = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM client_cases
       WHERE user_id = $1 AND contact_id = $2 AND status = 'open'`,
      [userId, contactId]
    );
    return Number(result.rows[0]?.count ?? 0);
  },

  /**
   * Loads a case by id for the owning advisor.
   */
  async findById(userId: string, caseId: string): Promise<ClientCaseRow | null> {
    const result = await getPool().query<ClientCaseRow>(
      `SELECT ${CASE_SELECT}
       FROM client_cases c
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.user_id = $1 AND c.id = $2
       LIMIT 1`,
      [userId, caseId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Creates an open case and default document placeholders.
   */
  async create(
    userId: string,
    contactId: string,
    input: {
      currentStage?: PipelineStage;
      title?: string;
    } = {}
  ): Promise<ClientCaseRow> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const caseResult = await client.query<ClientCaseRow>(
        `INSERT INTO client_cases (user_id, contact_id, current_stage, title)
         VALUES ($1, $2, $3::pipeline_stage, $4)
         RETURNING id`,
        [
          userId,
          contactId,
          input.currentStage ?? 'Initial Contact',
          input.title?.trim() || null,
        ]
      );

      const caseId = caseResult.rows[0].id;

      const defaultDocs = DEFAULT_CASE_DOCUMENTS;

      for (const doc of defaultDocs) {
        await client.query(
          `INSERT INTO case_documents (case_id, document_type, label)
           VALUES ($1, $2, $3)`,
          [caseId, doc.documentType, doc.label]
        );
      }

      await client.query('COMMIT');

      const created = await caseRepository.findById(userId, caseId);
      if (!created) {
        throw new Error('Failed to load created case');
      }
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Partially updates case fields for the owning advisor.
   */
  async update(
    userId: string,
    caseId: string,
    patch: Record<string, unknown>
  ): Promise<ClientCaseRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [caseId, userId];
    let paramIndex = 3;

    const add = (column: string, value: unknown, cast?: string) => {
      params.push(value);
      sets.push(`${column} = $${paramIndex}${cast ?? ''}`);
      paramIndex += 1;
    };

    if (patch.currentStage !== undefined) {
      add('current_stage', patch.currentStage, '::pipeline_stage');
    }
    if (patch.status !== undefined) {
      add('status', patch.status, '::case_status');
    }
    if (patch.title !== undefined) {
      add('title', patch.title);
    }
    if (patch.ficaIdReceived !== undefined) {
      add('fica_id_received', patch.ficaIdReceived);
    }
    if (patch.ficaResidenceReceived !== undefined) {
      add('fica_residence_received', patch.ficaResidenceReceived);
    }
    if (patch.ficaBankReceived !== undefined) {
      add('fica_bank_received', patch.ficaBankReceived);
    }
    if (patch.ficaSkipAcknowledged !== undefined) {
      add('fica_skip_acknowledged', patch.ficaSkipAcknowledged);
    }
    if (patch.consentSentAt !== undefined) {
      add('consent_sent_at', patch.consentSentAt);
    }
    if (patch.monthlyIncome !== undefined) {
      add('monthly_income', patch.monthlyIncome);
    }
    if (patch.monthlyExpenses !== undefined) {
      add('monthly_expenses', patch.monthlyExpenses);
    }
    if (patch.financialGoals !== undefined) {
      add('financial_goals', patch.financialGoals);
    }
    if (patch.riskProfile !== undefined) {
      add('risk_profile', patch.riskProfile);
    }
    if (patch.factFindNotes !== undefined) {
      add('fact_find_notes', patch.factFindNotes);
    }
    if (patch.quoteProductType !== undefined) {
      add('quote_product_type', patch.quoteProductType);
    }
    if (patch.chosenInsurer !== undefined) {
      add('chosen_insurer', patch.chosenInsurer);
    }
    if (patch.quotePremium !== undefined) {
      add('quote_premium', patch.quotePremium);
    }
    if (patch.estimatedCommission !== undefined) {
      add('estimated_commission', patch.estimatedCommission);
    }
    if (patch.replacementAdviceRequired !== undefined) {
      add('replacement_advice_required', patch.replacementAdviceRequired);
    }
    if (patch.replacementAdviceConfirmed !== undefined) {
      add('replacement_advice_confirmed', patch.replacementAdviceConfirmed);
    }
    if (patch.clientApproved !== undefined) {
      add('client_approved', patch.clientApproved);
    }
    if (patch.reviewDueAt !== undefined) {
      add('review_due_at', patch.reviewDueAt);
    }
    if (patch.linkedProductionId !== undefined) {
      add('linked_production_id', patch.linkedProductionId);
    }
    if (patch.factFindMode !== undefined) {
      add('fact_find_mode', patch.factFindMode);
    }
    if (patch.simpleGoalProduct !== undefined) {
      add('simple_goal_product', patch.simpleGoalProduct);
    }
    if (patch.simpleGoalAmount !== undefined) {
      add('simple_goal_amount', patch.simpleGoalAmount);
    }
    if (patch.maritalStatus !== undefined) {
      add('marital_status', patch.maritalStatus);
    }
    if (patch.dependentsNotes !== undefined) {
      add('dependents_notes', patch.dependentsNotes);
    }
    if (patch.fixedAssetsTotal !== undefined) {
      add('fixed_assets_total', patch.fixedAssetsTotal);
    }
    if (patch.nonFixedAssetsTotal !== undefined) {
      add('non_fixed_assets_total', patch.nonFixedAssetsTotal);
    }
    if (patch.investmentsTotal !== undefined) {
      add('investments_total', patch.investmentsTotal);
    }
    if (patch.liabilitiesTotal !== undefined) {
      add('liabilities_total', patch.liabilitiesTotal);
    }
    if (patch.savingsMonthly !== undefined) {
      add('savings_monthly', patch.savingsMonthly);
    }
    if (patch.employerBenefitsNotes !== undefined) {
      add('employer_benefits_notes', patch.employerBenefitsNotes);
    }
    if (patch.businessInterestsNotes !== undefined) {
      add('business_interests_notes', patch.businessInterestsNotes);
    }
    if (patch.retirementFundsNotes !== undefined) {
      add('retirement_funds_notes', patch.retirementFundsNotes);
    }
    if (patch.lifeCoverNotes !== undefined) {
      add('life_cover_notes', patch.lifeCoverNotes);
    }
    if (patch.estatePlanningNotes !== undefined) {
      add('estate_planning_notes', patch.estatePlanningNotes);
    }
    if (patch.quotesRequestedNotes !== undefined) {
      add('quotes_requested_notes', patch.quotesRequestedNotes);
    }
    if (patch.analysisQuotes !== undefined) {
      add('analysis_quotes', JSON.stringify(patch.analysisQuotes), '::jsonb');
    }
    if (patch.nextStepDate !== undefined) {
      add('next_step_date', patch.nextStepDate);
    }
    if (patch.stageDates !== undefined) {
      add('stage_dates', JSON.stringify(patch.stageDates), '::jsonb');
    }

    if (sets.length === 0) {
      return caseRepository.findById(userId, caseId);
    }

    await getPool().query(
      `UPDATE client_cases SET ${sets.join(', ')}
       WHERE id = $1 AND user_id = $2`,
      params
    );

    return caseRepository.findById(userId, caseId);
  },

  /**
   * Lists compliance document rows for a case.
   */
  async listDocuments(caseId: string): Promise<CaseDocumentRow[]> {
    const result = await getPool().query<CaseDocumentRow>(
      `SELECT id, case_id, document_type, label, sent_at, received_at, notes, created_at, updated_at
       FROM case_documents
       WHERE case_id = $1
       ORDER BY created_at ASC`,
      [caseId]
    );
    return result.rows;
  },

  /**
   * Adds a document record to a case.
   */
  async addDocument(
    caseId: string,
    input: { documentType: string; label: string; notes?: string }
  ): Promise<CaseDocumentRow> {
    const result = await getPool().query<CaseDocumentRow>(
      `INSERT INTO case_documents (case_id, document_type, label, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id, case_id, document_type, label, sent_at, received_at, notes, created_at, updated_at`,
      [caseId, input.documentType, input.label.trim(), input.notes?.trim() || null]
    );
    return result.rows[0];
  },

  /**
   * Updates sent/received timestamps on a document.
   */
  async updateDocument(
    caseId: string,
    documentId: string,
    patch: { sentAt?: Date | null; receivedAt?: Date | null; notes?: string | null }
  ): Promise<CaseDocumentRow | null> {
    const sets: string[] = [];
    const params: unknown[] = [documentId, caseId];
    let paramIndex = 3;

    if (patch.sentAt !== undefined) {
      params.push(patch.sentAt);
      sets.push(`sent_at = $${paramIndex++}`);
    }
    if (patch.receivedAt !== undefined) {
      params.push(patch.receivedAt);
      sets.push(`received_at = $${paramIndex++}`);
    }
    if (patch.notes !== undefined) {
      params.push(patch.notes);
      sets.push(`notes = $${paramIndex++}`);
    }

    if (sets.length === 0) {
      const result = await getPool().query<CaseDocumentRow>(
        `SELECT id, case_id, document_type, label, sent_at, received_at, notes, created_at, updated_at
         FROM case_documents WHERE id = $1 AND case_id = $2`,
        [documentId, caseId]
      );
      return result.rows[0] ?? null;
    }

    const result = await getPool().query<CaseDocumentRow>(
      `UPDATE case_documents SET ${sets.join(', ')}
       WHERE id = $1 AND case_id = $2
       RETURNING id, case_id, document_type, label, sent_at, received_at, notes, created_at, updated_at`,
      params
    );
    return result.rows[0] ?? null;
  },

  /**
   * Lists upcoming case step dates for the dashboard events feed.
   */
  async listUpcomingStepDates(
    userId: string,
    limit = 8
  ): Promise<
    Array<{
      id: string;
      contactId: string;
      contactName: string;
      title: string;
      scheduledAt: string;
    }>
  > {
    const result = await getPool().query<{
      id: string;
      contact_id: string;
      contact_first_name: string | null;
      contact_last_name: string | null;
      current_stage: string;
      title: string | null;
      event_date: Date;
    }>(
      `SELECT
         c.id,
         c.contact_id,
         ct.first_name AS contact_first_name,
         ct.last_name AS contact_last_name,
         c.current_stage::text AS current_stage,
         c.title,
         COALESCE(c.next_step_date, c.review_due_at)::date AS event_date
       FROM client_cases c
       JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.user_id = $1
         AND c.status = 'open'
         AND COALESCE(c.next_step_date, c.review_due_at) IS NOT NULL
         AND COALESCE(c.next_step_date, c.review_due_at) >= CURRENT_DATE
       ORDER BY event_date ASC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => {
      const contactName = [row.contact_first_name, row.contact_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      return {
        id: `case-${row.id}`,
        contactId: row.contact_id,
        contactName,
        title: row.title?.trim() || row.current_stage.replace('Interview', 'Fact-finding'),
        scheduledAt: row.event_date.toISOString().slice(0, 10),
      };
    });
  },
};
