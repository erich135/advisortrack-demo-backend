import { isDatabaseActive } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import {
  FICA_GATED_STAGES,
  getPipelineStageLabel,
  isFicaComplete,
  PipelineStage,
} from '../features/pipelineStages';
import { caseRepository, ClientCaseRow, CaseDocumentRow } from '../repositories/case.repository';
import { productionRepository } from '../repositories/production.repository';
import { contactRepository } from '../repositories/contact.repository';
import { activityRepository } from '../repositories/activity.repository';
import {
  CreateCaseDocumentInput,
  CreateCaseInput,
  UpdateCaseDocumentInput,
  UpdateCaseInput,
} from '../validators/schemas';

export interface AnalysisQuoteLine {
  productType?: string;
  insurer?: string;
  premium?: number;
  commission?: number;
}

export interface CaseDocumentDto {
  id: string;
  documentType: string;
  label: string;
  sentAt?: string;
  receivedAt?: string;
  notes?: string;
}

export interface ClientCaseDto {
  id: string;
  contactId: string;
  contactName: string;
  currentStage: PipelineStage;
  status: string;
  title?: string;
  ficaIdReceived: boolean;
  ficaResidenceReceived: boolean;
  ficaBankReceived: boolean;
  ficaSkipAcknowledged: boolean;
  consentSentAt?: string;
  factFindMode?: string;
  simpleGoalProduct?: string;
  simpleGoalAmount?: number;
  maritalStatus?: string;
  dependentsNotes?: string;
  fixedAssetsTotal?: number;
  nonFixedAssetsTotal?: number;
  investmentsTotal?: number;
  liabilitiesTotal?: number;
  savingsMonthly?: number;
  employerBenefitsNotes?: string;
  businessInterestsNotes?: string;
  retirementFundsNotes?: string;
  lifeCoverNotes?: string;
  estatePlanningNotes?: string;
  quotesRequestedNotes?: string;
  analysisQuotes: AnalysisQuoteLine[];
  nextStepDate?: string;
  /** ISO datetime of the synced pipeline activity (for date+time hydrate). */
  nextStepScheduledAt?: string;
  stageDates?: Record<string, string>;
  monthlyIncome?: number;
  monthlyExpenses?: number;
  financialGoals?: string;
  riskProfile?: string;
  factFindNotes?: string;
  quoteProductType?: string;
  chosenInsurer?: string;
  quotePremium?: number;
  estimatedCommission?: number;
  replacementAdviceRequired: boolean;
  replacementAdviceConfirmed: boolean;
  clientApproved?: boolean;
  reviewDueAt?: string;
  linkedProductionId?: string;
  documents: CaseDocumentDto[];
  ficaComplete: boolean;
  ficaWarning?: string;
  createdAt: string;
  updatedAt: string;
}

const mapDocument = (row: CaseDocumentRow): CaseDocumentDto => ({
  id: row.id,
  documentType: row.document_type,
  label: row.label,
  sentAt: row.sent_at?.toISOString(),
  receivedAt: row.received_at?.toISOString(),
  notes: row.notes ?? undefined,
});

/**
 * Maps a database case row to the public API DTO.
 */
const mapCase = (row: ClientCaseRow, documents: CaseDocumentRow[]): ClientCaseDto => {
  const fica = {
    ficaIdReceived: row.fica_id_received,
    ficaResidenceReceived: row.fica_residence_received,
    ficaBankReceived: row.fica_bank_received,
  };

  const rawQuotes = row.analysis_quotes;
  const analysisQuotes: AnalysisQuoteLine[] = Array.isArray(rawQuotes)
    ? (rawQuotes as AnalysisQuoteLine[])
    : [];

  const rawStageDates = row.stage_dates;
  const stageDates =
    rawStageDates && typeof rawStageDates === 'object' && !Array.isArray(rawStageDates)
      ? (rawStageDates as Record<string, string>)
      : undefined;

  return {
    id: row.id,
    contactId: row.contact_id,
    contactName: [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' ').trim(),
    currentStage: row.current_stage as PipelineStage,
    status: row.status,
    title: row.title ?? undefined,
    ...fica,
    ficaSkipAcknowledged: row.fica_skip_acknowledged,
    consentSentAt: row.consent_sent_at?.toISOString(),
    factFindMode: row.fact_find_mode ?? undefined,
    simpleGoalProduct: row.simple_goal_product ?? undefined,
    simpleGoalAmount:
      row.simple_goal_amount != null ? Number(row.simple_goal_amount) : undefined,
    maritalStatus: row.marital_status ?? undefined,
    dependentsNotes: row.dependents_notes ?? undefined,
    fixedAssetsTotal:
      row.fixed_assets_total != null ? Number(row.fixed_assets_total) : undefined,
    nonFixedAssetsTotal:
      row.non_fixed_assets_total != null ? Number(row.non_fixed_assets_total) : undefined,
    investmentsTotal:
      row.investments_total != null ? Number(row.investments_total) : undefined,
    liabilitiesTotal:
      row.liabilities_total != null ? Number(row.liabilities_total) : undefined,
    savingsMonthly: row.savings_monthly != null ? Number(row.savings_monthly) : undefined,
    employerBenefitsNotes: row.employer_benefits_notes ?? undefined,
    businessInterestsNotes: row.business_interests_notes ?? undefined,
    retirementFundsNotes: row.retirement_funds_notes ?? undefined,
    lifeCoverNotes: row.life_cover_notes ?? undefined,
    estatePlanningNotes: row.estate_planning_notes ?? undefined,
    quotesRequestedNotes: row.quotes_requested_notes ?? undefined,
    analysisQuotes,
    nextStepDate: row.next_step_date?.toISOString().slice(0, 10),
    stageDates,
    monthlyIncome: row.monthly_income != null ? Number(row.monthly_income) : undefined,
    monthlyExpenses: row.monthly_expenses != null ? Number(row.monthly_expenses) : undefined,
    financialGoals: row.financial_goals ?? undefined,
    riskProfile: row.risk_profile ?? undefined,
    factFindNotes: row.fact_find_notes ?? undefined,
    quoteProductType: row.quote_product_type ?? undefined,
    chosenInsurer: row.chosen_insurer ?? undefined,
    quotePremium: row.quote_premium != null ? Number(row.quote_premium) : undefined,
    estimatedCommission:
      row.estimated_commission != null ? Number(row.estimated_commission) : undefined,
    replacementAdviceRequired: row.replacement_advice_required,
    replacementAdviceConfirmed: row.replacement_advice_confirmed,
    clientApproved: row.client_approved ?? undefined,
    reviewDueAt: row.review_due_at?.toISOString().slice(0, 10),
    linkedProductionId: row.linked_production_id ?? undefined,
    documents: documents.map(mapDocument),
    ficaComplete: isFicaComplete(fica),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
};

/** In-memory fallback for development without PostgreSQL. */
const memoryCases = new Map<string, ClientCaseDto>();

/**
 * Client case business logic — 6-step pipeline, FICA, fact-find, production sync.
 */
export class CaseService {
  /**
   * Returns how many open pipeline cases exist for a contact.
   */
  async getOpenCaseCount(userId: string, contactId: string): Promise<number> {
    if (!isDatabaseActive()) {
      const key = `${userId}:${contactId}`;
      return memoryCases.has(key) ? 1 : 0;
    }
    return caseRepository.countOpenByContact(userId, contactId);
  }

  /**
   * Returns the open case for a contact, creating one if missing.
   */
  async getOrCreateForContact(userId: string, contactId: string): Promise<ClientCaseDto> {
    if (!isDatabaseActive()) {
      const key = `${userId}:${contactId}`;
      if (!memoryCases.has(key)) {
        memoryCases.set(key, this.buildMemoryCase(userId, contactId));
      }
      return memoryCases.get(key)!;
    }

    const contact = await contactRepository.findById(userId, contactId);
    if (!contact) {
      throw new AppError(404, 'Contact not found', 'NOT_FOUND');
    }

    let row = await caseRepository.findOpenByContact(userId, contactId);
    if (!row) {
      await caseRepository.create(userId, contactId, {
        title: `${contact.firstName} ${contact.lastName}`.trim(),
      });
      row = await caseRepository.findOpenByContact(userId, contactId);
    }

    if (!row) {
      throw new AppError(500, 'Could not open case for contact', 'CASE_CREATE_FAILED');
    }

    const documents = await caseRepository.listDocuments(row.id);
    const dto = mapCase(row, documents);
    dto.nextStepScheduledAt = await activityRepository.findScheduledDueAtForCase(
      userId,
      row.id,
      row.current_stage
    );
    return dto;
  }
  async getById(userId: string, caseId: string): Promise<ClientCaseDto> {
    if (!isDatabaseActive()) {
      const found = [...memoryCases.values()].find((c) => c.id === caseId);
      if (!found) {
        throw new AppError(404, 'Case not found', 'NOT_FOUND');
      }
      return found;
    }

    const row = await caseRepository.findById(userId, caseId);
    if (!row) {
      throw new AppError(404, 'Case not found', 'NOT_FOUND');
    }

    const documents = await caseRepository.listDocuments(caseId);
    return mapCase(row, documents);
  }

  /**
   * Creates an open case for a contact (fails if one already exists).
   */
  async create(userId: string, input: CreateCaseInput): Promise<ClientCaseDto> {
    if (!isDatabaseActive()) {
      return this.getOrCreateForContact(userId, input.contactId);
    }

    const contact = await contactRepository.findById(userId, input.contactId);
    if (!contact) {
      throw new AppError(404, 'Contact not found', 'NOT_FOUND');
    }

    const existing = await caseRepository.findOpenByContact(userId, input.contactId);
    if (existing) {
      const documents = await caseRepository.listDocuments(existing.id);
      return mapCase(existing, documents);
    }

    const row = await caseRepository.create(userId, input.contactId, {
      currentStage: input.currentStage,
      title: input.title ?? `${contact.firstName} ${contact.lastName}`.trim(),
    });

    const documents = await caseRepository.listDocuments(row.id);
    return mapCase(row, documents);
  }

  /**
   * Updates case fields, syncs production draft when quote commission is set.
   */
  async update(userId: string, caseId: string, input: UpdateCaseInput): Promise<ClientCaseDto> {
    if (!isDatabaseActive()) {
      const key = [...memoryCases.entries()].find(([, c]) => c.id === caseId)?.[0];
      if (!key) {
        throw new AppError(404, 'Case not found', 'NOT_FOUND');
      }
      const current = memoryCases.get(key)!;
      const updated = { ...current, ...input, updatedAt: new Date().toISOString() };
      memoryCases.set(key, updated as ClientCaseDto);
      return updated as ClientCaseDto;
    }

    const existing = await caseRepository.findById(userId, caseId);
    if (!existing) {
      throw new AppError(404, 'Case not found', 'NOT_FOUND');
    }

    const nextStage = (input.currentStage ?? existing.current_stage) as PipelineStage;
    const ficaAfter = {
      ficaIdReceived: input.ficaIdReceived ?? existing.fica_id_received,
      ficaResidenceReceived: input.ficaResidenceReceived ?? existing.fica_residence_received,
      ficaBankReceived: input.ficaBankReceived ?? existing.fica_bank_received,
    };

    let ficaWarning: string | undefined;
    if (
      FICA_GATED_STAGES.includes(nextStage) &&
      !isFicaComplete(ficaAfter) &&
      !input.acknowledgeFicaIncomplete
    ) {
      ficaWarning =
        'FICA is incomplete. Proof of ID, residence, and bank details are required before fact-finding — or skip with acknowledgment.';
    }

    let stageDatesPatch: Record<string, string> | undefined;
    if (input.nextStepDate !== undefined) {
      const existingDates =
        existing.stage_dates &&
        typeof existing.stage_dates === 'object' &&
        !Array.isArray(existing.stage_dates)
          ? ({ ...(existing.stage_dates as Record<string, string>) } as Record<string, string>)
          : {};
      if (input.nextStepDate) {
        existingDates[nextStage] = input.nextStepDate;
      } else {
        delete existingDates[nextStage];
      }
      stageDatesPatch = existingDates;
    }

    let row = await caseRepository.update(userId, caseId, {
      currentStage: input.currentStage,
      status: input.status,
      title: input.title,
      ficaIdReceived: input.ficaIdReceived,
      ficaResidenceReceived: input.ficaResidenceReceived,
      ficaBankReceived: input.ficaBankReceived,
      ficaSkipAcknowledged: input.ficaSkipAcknowledged,
      consentSentAt: input.consentSentAt ? new Date(input.consentSentAt) : undefined,
      monthlyIncome: input.monthlyIncome,
      monthlyExpenses: input.monthlyExpenses,
      financialGoals: input.financialGoals,
      riskProfile: input.riskProfile,
      factFindNotes: input.factFindNotes,
      quoteProductType: input.quoteProductType,
      chosenInsurer: input.chosenInsurer,
      quotePremium: input.quotePremium,
      estimatedCommission: input.estimatedCommission,
      replacementAdviceRequired: input.replacementAdviceRequired,
      replacementAdviceConfirmed: input.replacementAdviceConfirmed,
      clientApproved: input.clientApproved,
      reviewDueAt: input.reviewDueAt,
      factFindMode: input.factFindMode,
      simpleGoalProduct: input.simpleGoalProduct,
      simpleGoalAmount: input.simpleGoalAmount,
      maritalStatus: input.maritalStatus,
      dependentsNotes: input.dependentsNotes,
      fixedAssetsTotal: input.fixedAssetsTotal,
      nonFixedAssetsTotal: input.nonFixedAssetsTotal,
      investmentsTotal: input.investmentsTotal,
      liabilitiesTotal: input.liabilitiesTotal,
      savingsMonthly: input.savingsMonthly,
      employerBenefitsNotes: input.employerBenefitsNotes,
      businessInterestsNotes: input.businessInterestsNotes,
      retirementFundsNotes: input.retirementFundsNotes,
      lifeCoverNotes: input.lifeCoverNotes,
      estatePlanningNotes: input.estatePlanningNotes,
      quotesRequestedNotes: input.quotesRequestedNotes,
      analysisQuotes: input.analysisQuotes,
      nextStepDate: input.nextStepDate,
      stageDates: stageDatesPatch,
    });

    if (!row) {
      throw new AppError(404, 'Case not found', 'NOT_FOUND');
    }

    const estimatedCommission =
      input.estimatedCommission ??
      (row.estimated_commission != null ? Number(row.estimated_commission) : undefined);

    if (input.submitToProduction && estimatedCommission != null && estimatedCommission > 0) {
      await this.syncProductionDraft(userId, row, estimatedCommission, true);

      const reviewDue = new Date();
      reviewDue.setMonth(reviewDue.getMonth() + 11);
      await caseRepository.update(userId, caseId, {
        reviewDueAt: reviewDue.toISOString().slice(0, 10),
        currentStage: 'Implementation',
      });
      row = (await caseRepository.findById(userId, caseId)) ?? row;
    }

    const documents = await caseRepository.listDocuments(caseId);
    const dto = mapCase(row, documents);

    if (input.nextStepDate && row.contact_id) {
      const contactName = [row.contact_first_name, row.contact_last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      const scheduledAt =
        input.nextStepScheduledAt ||
        `${input.nextStepDate}T11:00:00.000Z`;
      await activityRepository.upsertScheduledForCase(userId, {
        caseId: row.id,
        contactId: row.contact_id,
        pipelineStage: nextStage,
        title: `${getPipelineStageLabel(nextStage)} — ${contactName || 'Client'}`,
        scheduledAt,
        description: 'Auto-synced from pipeline activity target date',
      });
    }

    if (ficaWarning) {
      dto.ficaWarning = ficaWarning;
    }
    return dto;
  }

  /**
   * Creates or updates a linked production entry (estimated, not issued).
   */
  async syncProductionDraft(
    userId: string,
    caseRow: ClientCaseRow,
    amount: number,
    markSubmitted = false
  ): Promise<void> {
    const contactName = [caseRow.contact_first_name, caseRow.contact_last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    const title =
      caseRow.quote_product_type?.trim() ||
      `Case — ${contactName || 'Client'}`.trim();

    const providerTag = caseRow.chosen_insurer?.trim();
    const providerNote = providerTag ? `Provider: ${providerTag}` : undefined;

    if (caseRow.linked_production_id) {
      await productionRepository.update(userId, caseRow.linked_production_id, {
        amount,
        title,
        productName: caseRow.quote_product_type ?? undefined,
        notes: providerNote,
        pipelineStage: caseRow.current_stage as PipelineStage,
        ...(markSubmitted ? { applicationStatus: 'application_received' as const } : {}),
      });
      return;
    }

    const production = await productionRepository.create(userId, {
      title,
      type: 'commission',
      amount,
      contactId: caseRow.contact_id,
      contactName,
      productName: caseRow.quote_product_type ?? undefined,
      pipelineStage: caseRow.current_stage as PipelineStage,
      isIssued: false,
      applicationStatus: markSubmitted ? 'application_received' : undefined,
      date: new Date().toISOString().slice(0, 10),
      notes: providerNote,
      tags: [],
      caseId: caseRow.id,
    });

    await caseRepository.update(userId, caseRow.id, {
      linkedProductionId: production.id,
    });
  }

  /**
   * Duplicates phases 1–2 (initial contact + fact-find) into a new open case for another product.
   */
  async duplicateCase(userId: string, caseId: string): Promise<ClientCaseDto> {
    const source = await this.getById(userId, caseId);

    if (!isDatabaseActive()) {
      const copy = {
        ...source,
        id: `case-copy-${Date.now()}`,
        title: `${source.title ?? source.contactName} — copy`,
        currentStage: 'Interview' as PipelineStage,
        linkedProductionId: undefined,
        documents: source.documents.map((d, i) => ({
          ...d,
          id: `d-copy-${i}`,
          sentAt: undefined,
          receivedAt: undefined,
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memoryCases.set(`${userId}:${source.contactId}:copy`, copy);
      return copy;
    }

    const row = await caseRepository.create(userId, source.contactId, {
      currentStage: 'Interview',
      title: `${source.title ?? source.contactName} — additional product`,
    });

    await caseRepository.update(userId, row.id, {
      ficaIdReceived: source.ficaIdReceived,
      ficaResidenceReceived: source.ficaResidenceReceived,
      ficaBankReceived: source.ficaBankReceived,
      factFindMode: source.factFindMode,
      simpleGoalProduct: source.simpleGoalProduct,
      simpleGoalAmount: source.simpleGoalAmount,
      maritalStatus: source.maritalStatus,
      dependentsNotes: source.dependentsNotes,
      monthlyIncome: source.monthlyIncome,
      monthlyExpenses: source.monthlyExpenses,
      financialGoals: source.financialGoals,
      riskProfile: source.riskProfile,
      factFindNotes: source.factFindNotes,
      fixedAssetsTotal: source.fixedAssetsTotal,
      nonFixedAssetsTotal: source.nonFixedAssetsTotal,
      investmentsTotal: source.investmentsTotal,
      liabilitiesTotal: source.liabilitiesTotal,
      savingsMonthly: source.savingsMonthly,
      employerBenefitsNotes: source.employerBenefitsNotes,
      businessInterestsNotes: source.businessInterestsNotes,
      retirementFundsNotes: source.retirementFundsNotes,
      lifeCoverNotes: source.lifeCoverNotes,
      estatePlanningNotes: source.estatePlanningNotes,
    });

    return this.getById(userId, row.id);
  }

  /**
   * Schedules an 11-month review reminder on the case.
   */
  async scheduleReview(userId: string, caseId: string): Promise<ClientCaseDto> {
    await this.getById(userId, caseId);
    const reviewDue = new Date();
    reviewDue.setMonth(reviewDue.getMonth() + 11);

    return this.update(userId, caseId, {
      currentStage: 'Review',
      reviewDueAt: reviewDue.toISOString().slice(0, 10),
      acknowledgeFicaIncomplete: true,
    });
  }

  /**
   * Adds a document placeholder to the case.
   */
  async addDocument(
    userId: string,
    caseId: string,
    input: CreateCaseDocumentInput
  ): Promise<ClientCaseDto> {
    const row = await caseRepository.findById(userId, caseId);
    if (!row) {
      throw new AppError(404, 'Case not found', 'NOT_FOUND');
    }

    await caseRepository.addDocument(caseId, input);
    return this.getById(userId, caseId);
  }

  /**
   * Marks a document as sent and/or received.
   */
  async updateDocument(
    userId: string,
    caseId: string,
    documentId: string,
    input: UpdateCaseDocumentInput
  ): Promise<ClientCaseDto> {
    const row = await caseRepository.findById(userId, caseId);
    if (!row) {
      throw new AppError(404, 'Case not found', 'NOT_FOUND');
    }

    await caseRepository.updateDocument(caseId, documentId, {
      sentAt: input.markSent ? new Date() : input.sentAt === null ? null : undefined,
      receivedAt: input.markReceived ? new Date() : input.receivedAt === null ? null : undefined,
      notes: input.notes,
    });

    return this.getById(userId, caseId);
  }

  /**
   * Creates an open case when a new contact is saved.
   */
  async createForNewContact(userId: string, contactId: string, contactName: string): Promise<void> {
    if (!isDatabaseActive()) {
      await this.getOrCreateForContact(userId, contactId);
      return;
    }

    const existing = await caseRepository.findOpenByContact(userId, contactId);
    if (!existing) {
      await caseRepository.create(userId, contactId, { title: contactName });
    }
  }

  private buildMemoryCase(_userId: string, contactId: string): ClientCaseDto {
    const now = new Date().toISOString();
    return {
      id: `case-${contactId}`,
      contactId,
      contactName: 'Client',
      currentStage: 'Initial Contact',
      status: 'open',
      ficaIdReceived: false,
      ficaResidenceReceived: false,
      ficaBankReceived: false,
      ficaSkipAcknowledged: false,
      replacementAdviceRequired: false,
      replacementAdviceConfirmed: false,
      analysisQuotes: [],
      documents: [
        { id: 'd1', documentType: 'consent', label: 'Letter of consent' },
        { id: 'd2', documentType: 'broker_disclosure', label: 'Broker disclosure' },
        { id: 'd3', documentType: 'appointment', label: 'Letter of appointment' },
      ],
      ficaComplete: false,
      createdAt: now,
      updatedAt: now,
    };
  }
}

export const caseService = new CaseService();
