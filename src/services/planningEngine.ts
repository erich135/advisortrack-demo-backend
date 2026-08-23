/**
 * Pipeline stage point weights — matches Weekly Point Allocation sheet.
 */
export const STAGE_POINT_WEIGHTS: Record<string, number> = {
  'Initial Contact': 1,
  Interview: 2,
  Analysis: 5,
  Recommendation: 10,
  Implementation: 15,
  Review: 2,
};

/** Points awarded when a case is issued (Acceptance phase). */
export const ISSUED_CASE_POINTS = 25;

/** SA 2025 monthly tax brackets (lower bound, upper bound, marginal rate). */
const MONTHLY_TAX_BRACKETS: { min: number; max: number; rate: number }[] = [
  { min: 0, max: 19758.33, rate: 0.18 },
  { min: 19758.34, max: 30875, rate: 0.26 },
  { min: 30875.01, max: 42733.33, rate: 0.31 },
  { min: 42733.34, max: 56083.33, rate: 0.36 },
  { min: 56083.34, max: 71491.67, rate: 0.39 },
  { min: 71491.68, max: Infinity, rate: 0.41 },
];

export interface PlanningRatioInputs {
  coldCallToInterview: number;
  interviewToAnalysis: number;
  analysisToRecommendation: number;
  recommendationToImplementation: number;
  submissionToIssued: number;
}

export interface PlanningInputs {
  monthlyGoalNett: number;
  monthlyDeductions: number;
  commissionSplit: number;
  effectiveTaxRate: number;
  avgCommission: number;
  ratios: PlanningRatioInputs;
  /** Active working weeks per year (default 44). */
  workingWeeksPerYear?: number;
  /** Prospecting days per week (default 5). */
  workingDaysPerWeek?: number;
}

export interface GrossTargetBreakdown {
  earningsBeforeTax: number;
  earningsBeforeDeductions: number;
  grossCommission: number;
  grossTarget: number;
}

export interface WeeklyDeliverables {
  casesIssuedPerMonth: number;
  casesIssuedPerWeek: number;
  casesSubmittedPerWeek: number;
  recommendationsPerWeek: number;
  quotesPerWeek: number;
  interviewsPerWeek: number;
  coldCallsPerWeek: number;
}

export interface DailyDeliverables {
  casesIssuedPerDay: number;
  casesSubmittedPerDay: number;
  recommendationsPerDay: number;
  quotesPerDay: number;
  interviewsPerDay: number;
  coldCallsPerDay: number;
}

export interface PlanningTargets {
  gross: GrossTargetBreakdown;
  weekly: WeeklyDeliverables;
  daily: DailyDeliverables;
  weeklyPointTarget: number;
}

/**
 * Rounds up to the nearest integer — matches Excel ROUNDUP.
 */
export const roundUp = (value: number): number => Math.ceil(value);

/**
 * Converts a 0–10 slider value from General Settings to a decimal ratio (e.g. 4 → 0.4).
 */
export const sliderToRatio = (sliderValue: number): number => sliderValue / 10;

/**
 * Parses commission split from profile text ("80%", "0.8", "80") to decimal (0.8).
 */
export const parseCommissionSplit = (value?: string | null): number => {
  if (!value?.trim()) {
    return 0.8;
  }
  const cleaned = value.replace(/%/g, '').trim();
  const parsed = parseFloat(cleaned);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 0.8;
  }
  return parsed > 1 ? parsed / 100 : parsed;
};

/**
 * Returns the marginal tax rate for a monthly nett target (Excel Set Target lookup).
 */
export const getMarginalTaxRateForNett = (monthlyNett: number): number => {
  for (const bracket of MONTHLY_TAX_BRACKETS) {
    if (monthlyNett >= bracket.min && monthlyNett <= bracket.max) {
      return bracket.rate;
    }
  }
  return MONTHLY_TAX_BRACKETS[MONTHLY_TAX_BRACKETS.length - 1].rate;
};

/**
 * Gross target chain — matches Set Target sheet (E10–E13).
 */
export const calculateGrossTarget = (inputs: PlanningInputs): GrossTargetBreakdown => {
  const earningsBeforeTax = inputs.monthlyGoalNett / (1 - inputs.effectiveTaxRate);
  const earningsBeforeDeductions = earningsBeforeTax + inputs.monthlyDeductions;
  const split = inputs.commissionSplit > 0 ? inputs.commissionSplit : 0.8;
  const grossCommission = earningsBeforeDeductions / split;
  const grossTarget = grossCommission * 1.25;

  return {
    earningsBeforeTax,
    earningsBeforeDeductions,
    grossCommission,
    grossTarget,
  };
};

/**
 * Reverse-funnel weekly activity counts — matches Define Activities sheet.
 */
export const calculateWeeklyDeliverables = (
  grossTarget: number,
  avgCommission: number,
  ratios: PlanningRatioInputs,
  workingWeeksPerYear = 44
): WeeklyDeliverables => {
  const weeks = workingWeeksPerYear > 0 ? workingWeeksPerYear : 44;
  const casesIssuedPerMonth = roundUp(grossTarget / avgCommission);
  const casesIssuedPerWeek = roundUp((casesIssuedPerMonth * 12) / weeks);
  const casesSubmittedPerWeek = roundUp(casesIssuedPerWeek / ratios.submissionToIssued);
  const recommendationsPerWeek = roundUp(casesSubmittedPerWeek / ratios.recommendationToImplementation);
  const quotesPerWeek = roundUp(recommendationsPerWeek / ratios.analysisToRecommendation);
  const interviewsPerWeek = roundUp(quotesPerWeek / ratios.interviewToAnalysis);
  const coldCallsPerWeek = roundUp(interviewsPerWeek / ratios.coldCallToInterview);

  return {
    casesIssuedPerMonth,
    casesIssuedPerWeek,
    casesSubmittedPerWeek,
    recommendationsPerWeek,
    quotesPerWeek,
    interviewsPerWeek,
    coldCallsPerWeek,
  };
};

/**
 * Daily prospecting goals — weekly deliverables divided by working days per week.
 */
export const calculateDailyDeliverables = (
  weekly: WeeklyDeliverables,
  workingDaysPerWeek = 5
): DailyDeliverables => {
  const days = workingDaysPerWeek > 0 ? workingDaysPerWeek : 5;

  return {
    casesIssuedPerDay: roundUp(weekly.casesIssuedPerWeek / days),
    casesSubmittedPerDay: roundUp(weekly.casesSubmittedPerWeek / days),
    recommendationsPerDay: roundUp(weekly.recommendationsPerWeek / days),
    quotesPerDay: roundUp(weekly.quotesPerWeek / days),
    interviewsPerDay: roundUp(weekly.interviewsPerWeek / days),
    coldCallsPerDay: roundUp(weekly.coldCallsPerWeek / days),
  };
};

/**
 * Weekly point target rounded to nearest 100 — matches Weekly Point Allocation I8.
 */
export const calculateWeeklyPointTarget = (weekly: WeeklyDeliverables): number => {
  const raw =
    weekly.coldCallsPerWeek * STAGE_POINT_WEIGHTS['Initial Contact'] +
    weekly.interviewsPerWeek * STAGE_POINT_WEIGHTS.Interview +
    weekly.quotesPerWeek * STAGE_POINT_WEIGHTS.Analysis +
    weekly.recommendationsPerWeek * STAGE_POINT_WEIGHTS.Recommendation +
    weekly.casesSubmittedPerWeek * STAGE_POINT_WEIGHTS.Implementation +
    weekly.casesIssuedPerWeek * ISSUED_CASE_POINTS;

  return Math.round(raw / 100) * 100;
};

/**
 * Full planning targets from advisor profile + general settings inputs.
 */
export const calculatePlanningTargets = (inputs: PlanningInputs): PlanningTargets => {
  const workingWeeks = inputs.workingWeeksPerYear ?? 44;
  const workingDays = inputs.workingDaysPerWeek ?? 5;
  const gross = calculateGrossTarget(inputs);
  const weekly = calculateWeeklyDeliverables(
    gross.grossTarget,
    inputs.avgCommission,
    inputs.ratios,
    workingWeeks
  );
  const daily = calculateDailyDeliverables(weekly, workingDays);
  const weeklyPointTarget = calculateWeeklyPointTarget(weekly);

  return { gross, weekly, daily, weeklyPointTarget };
};

/**
 * Maps pipeline stage counts to dashboard weekly stat targets.
 */
export const weeklyDeliverablesToStatTargets = (weekly: WeeklyDeliverables) => ({
  calls: weekly.coldCallsPerWeek,
  meetings: weekly.interviewsPerWeek,
  quotes: weekly.quotesPerWeek,
  submission: weekly.casesSubmittedPerWeek,
});

/**
 * Computes earned activity points from completed stage counts.
 */
export const calculateEarnedPoints = (
  stageCounts: Record<string, number>,
  issuedCasesCount = 0
): number => {
  let total = 0;
  for (const [stage, count] of Object.entries(stageCounts)) {
    const weight = STAGE_POINT_WEIGHTS[stage] ?? 0;
    total += count * weight;
  }
  total += issuedCasesCount * ISSUED_CASE_POINTS;
  return total;
};

/**
 * Returns point weight for a pipeline stage label.
 */
export const getStagePointWeight = (stage: string): number =>
  STAGE_POINT_WEIGHTS[stage] ?? 0;
