import { getPipelineStageLabel, PIPELINE_STAGES, type PipelineStage } from '../../features/pipelineStages';
import { BUSINESS_TIMEZONE, zonedCalendarDate } from '../../features/performancePeriod';

export type SelfCaseRow = {
  status: string;
  currentStage: string;
  estimatedCommission?: number | null;
  nextStepDate?: string | null;
  reviewDueAt?: string | null;
  ficaComplete: boolean;
  ficaSkipAcknowledged?: boolean;
  documentCount: number;
  documentsReceived: number;
  linkedProductionId?: string | null;
};

export type MyPipelineProjection = {
  openCaseCount: number;
  wonCaseCount: number;
  lostCaseCount: number;
  closedCaseCount: number;
  initialContactCount: number;
  factFindingCount: number;
  analysisCount: number;
  recommendationCount: number;
  implementationCount: number;
  reviewCount: number;
  totalEstimatedCommission: number;
  casesWithoutNextActionCount: number;
  ficaIncompleteCount: number;
  casesWithIncompleteDocumentsCount: number;
  reviewDueCount: number;
  submittedToProductionCount: number;
};

export type MyPipelineFocus =
  | 'open_count'
  | 'stage_count'
  | 'top_stage'
  | 'commission'
  | 'no_next_action'
  | 'fica'
  | 'documents'
  | 'reviews'
  | 'overview';

export type MyCaseSummaryProjection = {
  currentStage: string;
  stageLabel: string;
  status: string;
  ficaComplete: boolean;
  documentCount: number;
  documentsSent: number;
  documentsReceived: number;
  quoteCount: number;
  insurerSelected: boolean;
  estimatedCommission: number | null;
  hasNextAction: boolean;
  reviewDue: boolean;
  submittedToProduction: boolean;
};

const STAGE_COUNT_KEYS: Record<PipelineStage, keyof MyPipelineProjection> = {
  'Initial Contact': 'initialContactCount',
  Interview: 'factFindingCount',
  Analysis: 'analysisCount',
  Recommendation: 'recommendationCount',
  Implementation: 'implementationCount',
  Review: 'reviewCount',
};

function johannesburgYmd(at: Date): string {
  return zonedCalendarDate(at, BUSINESS_TIMEZONE).ymd;
}

function ymdOf(value?: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

export function projectMyPipeline(rows: SelfCaseRow[], now = new Date()): MyPipelineProjection {
  const today = johannesburgYmd(now);
  const empty: MyPipelineProjection = {
    openCaseCount: 0,
    wonCaseCount: 0,
    lostCaseCount: 0,
    closedCaseCount: 0,
    initialContactCount: 0,
    factFindingCount: 0,
    analysisCount: 0,
    recommendationCount: 0,
    implementationCount: 0,
    reviewCount: 0,
    totalEstimatedCommission: 0,
    casesWithoutNextActionCount: 0,
    ficaIncompleteCount: 0,
    casesWithIncompleteDocumentsCount: 0,
    reviewDueCount: 0,
    submittedToProductionCount: 0,
  };

  return rows.reduce((summary, row) => {
    if (row.status === 'open') summary.openCaseCount += 1;
    else if (row.status === 'won') summary.wonCaseCount += 1;
    else if (row.status === 'lost') summary.lostCaseCount += 1;
    else if (row.status === 'closed') summary.closedCaseCount += 1;

    if (row.status === 'open') {
      const key = STAGE_COUNT_KEYS[row.currentStage as PipelineStage];
      if (key) summary[key] = (summary[key] as number) + 1;
      summary.totalEstimatedCommission += Number(row.estimatedCommission ?? 0);
      if (!row.nextStepDate) summary.casesWithoutNextActionCount += 1;
      if (!row.ficaComplete && !row.ficaSkipAcknowledged) summary.ficaIncompleteCount += 1;
      if (row.documentCount > 0 && row.documentsReceived < row.documentCount) {
        summary.casesWithIncompleteDocumentsCount += 1;
      }
      const reviewDue = ymdOf(row.reviewDueAt);
      if (reviewDue && reviewDue <= today) summary.reviewDueCount += 1;
    }
    if (row.linkedProductionId) summary.submittedToProductionCount += 1;
    return summary;
  }, empty);
}

export function topPipelineStage(projection: MyPipelineProjection): { label: string; count: number } | null {
  let top: { label: string; count: number } | null = null;
  for (const stage of PIPELINE_STAGES) {
    const count = projection[STAGE_COUNT_KEYS[stage]] as number;
    if (!top || count > top.count) {
      top = { label: getPipelineStageLabel(stage), count };
    }
  }
  return top && top.count > 0 ? top : { label: getPipelineStageLabel('Initial Contact'), count: 0 };
}

export function detectMyPipelineFocus(normalized: string): MyPipelineFocus {
  if (/\b(fica|f\.?i\.?c\.?a)\b/.test(normalized)) return 'fica';
  if (/\bdocuments?\b/.test(normalized)) return 'documents';
  if (/\breviews?\b/.test(normalized)) return 'reviews';
  if (/\bnext action|next step\b/.test(normalized)) return 'no_next_action';
  if (/\b(commission|pipeline value|estimated)\b/.test(normalized)) return 'commission';
  if (/\b(which stage|most cases|most of my cases)\b/.test(normalized)) return 'top_stage';
  if (/\bfact[- ]?find/.test(normalized) || /\binterview\b/.test(normalized)) return 'stage_count';
  if (/\b(initial contact|analysis|recommendation|implementation|review)\b/.test(normalized)) {
    return 'stage_count';
  }
  if (/\bopen cases?\b/.test(normalized)) return 'open_count';
  return 'overview';
}

export function caseIdFromAdvisorPath(path: string | null | undefined): string | null {
  const match = (path ?? '').match(/^\/advisor\/cases\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1] ?? null;
}

export function projectMyCaseSummary(input: {
  currentStage: string;
  status: string;
  ficaComplete: boolean;
  documentCount: number;
  documentsSent: number;
  documentsReceived: number;
  quoteCount: number;
  insurerSelected: boolean;
  estimatedCommission?: number | null;
  hasNextAction: boolean;
  reviewDueAt?: string | null;
  submittedToProduction: boolean;
  now?: Date;
}): MyCaseSummaryProjection {
  const today = johannesburgYmd(input.now ?? new Date());
  const reviewYmd = ymdOf(input.reviewDueAt);
  return {
    currentStage: input.currentStage,
    stageLabel: getPipelineStageLabel(input.currentStage),
    status: input.status,
    ficaComplete: input.ficaComplete,
    documentCount: input.documentCount,
    documentsSent: input.documentsSent,
    documentsReceived: input.documentsReceived,
    quoteCount: input.quoteCount,
    insurerSelected: input.insurerSelected,
    estimatedCommission: input.estimatedCommission ?? null,
    hasNextAction: input.hasNextAction,
    reviewDue: Boolean(reviewYmd && reviewYmd <= today),
    submittedToProduction: input.submittedToProduction,
  };
}

export function myCaseNextStepBody(projection: MyCaseSummaryProjection): string {
  const stageLine = `This case is in ${projection.stageLabel}.`;
  if (projection.status === 'lost') {
    return `${stageLine} Status is lost. Lost is a recorded case status; AdvisorTrack does not offer undo.`;
  }
  if (projection.status === 'closed') {
    return `${stageLine} Status is closed.`;
  }
  if (projection.status === 'won') {
    return `${stageLine} Status is won.`;
  }
  const gaps: string[] = [];
  if (!projection.ficaComplete) gaps.push('FICA is incomplete');
  if (!projection.hasNextAction) gaps.push('no next action is scheduled');
  if (projection.documentCount > 0 && projection.documentsReceived < projection.documentCount) {
    gaps.push('the document checklist is incomplete');
  }
  if (projection.currentStage === 'Analysis' && projection.quoteCount === 0) {
    gaps.push('no quotes have been added yet');
  }
  if (
    (projection.currentStage === 'Recommendation' || projection.currentStage === 'Implementation')
    && !projection.insurerSelected
  ) {
    gaps.push('no insurer has been selected yet');
  }
  if (!projection.submittedToProduction && (projection.estimatedCommission ?? 0) <= 0) {
    gaps.push('estimated commission is still zero, so submit to Production is not available');
  }
  if (gaps.length) {
    const [first, ...rest] = gaps;
    const lead = first.charAt(0).toUpperCase() + first.slice(1);
    return `${stageLine} ${[lead, ...rest].join(' and ')}. You can complete the outstanding AdvisorTrack workflow items on this case. This is not financial advice.`;
  }
  if (!projection.submittedToProduction && (projection.estimatedCommission ?? 0) > 0) {
    return `${stageLine} Estimated commission is recorded. You can submit this case to Production from the case page when you are ready. Submitting does not close the case. This is not financial advice.`;
  }
  if (projection.submittedToProduction && projection.status === 'open') {
    return `${stageLine} It is already submitted to Production and remains open. You can schedule a review when you are ready. This is not financial advice.`;
  }
  if (projection.reviewDue) {
    return `${stageLine} A review date is due. Open Review & servicing on this case. This is not financial advice.`;
  }
  return `${stageLine} The recorded workflow fields for this case look complete. Use Move to stage, next action, or schedule a review as the advice journey requires. This is not financial advice.`;
}
