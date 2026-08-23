/**
 * Pipeline stage keys (DB/API) and advisor-facing labels.
 * DB enum still uses "Interview"; UI shows "Fact-finding".
 */
export const PIPELINE_STAGES = [
  'Initial Contact',
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Maps API stage values to display labels in the mobile app. */
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  'Initial Contact': 'Initial contact',
  Interview: 'Fact-finding',
  Analysis: 'Analysis & quotes',
  Recommendation: 'Recommendation',
  Implementation: 'Implementation',
  Review: 'Review & servicing',
};

/** Ordered steps for the 6-step advisor workflow (1–6). */
export const PIPELINE_STAGE_STEPS: Record<PipelineStage, number> = {
  'Initial Contact': 1,
  Interview: 2,
  Analysis: 3,
  Recommendation: 4,
  Implementation: 5,
  Review: 6,
};

/**
 * Returns the UI label for a pipeline stage string.
 */
export const getPipelineStageLabel = (stage: string): string =>
  PIPELINE_STAGE_LABELS[stage as PipelineStage] ?? stage;

/**
 * Stages that require FICA checkboxes before fact-finding (soft gate — warning only).
 */
export const FICA_GATED_STAGES: PipelineStage[] = [
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review',
];

/**
 * Returns true when all three FICA flags are set on a case.
 */
export const isFicaComplete = (fica: {
  ficaIdReceived: boolean;
  ficaResidenceReceived: boolean;
  ficaBankReceived: boolean;
}): boolean =>
  fica.ficaIdReceived && fica.ficaResidenceReceived && fica.ficaBankReceived;

/** Phase 1 documents sent at initial contact. */
export const DEFAULT_CASE_DOCUMENTS = [
  { documentType: 'consent', label: 'Letter of consent' },
  { documentType: 'broker_disclosure', label: 'Broker disclosure' },
  { documentType: 'appointment', label: 'Letter of appointment' },
] as const;

/** Risk profile options aligned with FAIS fact-finding. */
export const RISK_PROFILE_OPTIONS = [
  'Conservative',
  'Moderate',
  'Moderately aggressive',
  'Aggressive',
] as const;

export const MARITAL_STATUS_OPTIONS = [
  'Single',
  'Married in community of property',
  'Married ANC',
  'Married ANC with accrual',
  'Divorced',
  'Widowed',
] as const;

export const FACT_FIND_MODES = ['simple_goal', 'full_fna'] as const;
export type FactFindMode = (typeof FACT_FIND_MODES)[number];
