import { WeeklyDeliverables } from './planningEngine';

/**
 * Industry-default conversion ratios (0–10 slider scale).
 * Used when insufficient activity data exists for adaptive calculation.
 */
export const INDUSTRY_RATIO_SLIDERS = {
  coldCallToInterview: 4,
  interviewToAnalysis: 6,
  analysisToRecommendation: 6,
  recommendationToImplementation: 6,
  submissionToIssued: 8,
} as const;

/** Minimum completed upstream activities before trusting an observed ratio. */
export const MIN_UPSTREAM_SAMPLE = 3;

/** Weight given to newly observed data when blending (remainder keeps prior slider). */
export const ADAPTIVE_BLEND_WEIGHT = 0.65;

export interface PipelineStageCounts {
  [stage: string]: number;
}

export interface ProductionFunnelCounts {
  submitted: number;
  issued: number;
}

export interface AdaptiveRatioSliders {
  coldCallToInterviewRatio: number;
  interviewToAnalysisRatio: number;
  analysisToRecommendationRatio: number;
  recommendationToImplementationRatio: number;
  submissionToIssuedRatio: number;
}

/**
 * Clamps a slider value to the valid 0–10 range with a sensible minimum.
 */
export const clampSlider = (value: number): number =>
  Math.round(Math.max(0.5, Math.min(10, value)) * 10) / 10;

/**
 * Converts observed funnel counts to a 0–10 slider (e.g. 12% → 1.2).
 */
export const observedConversionToSlider = (
  downstream: number,
  upstream: number,
  fallback: number
): number => {
  if (upstream < MIN_UPSTREAM_SAMPLE) {
    return fallback;
  }
  const observed = (downstream / upstream) * 10;
  return clampSlider(observed);
};

/**
 * Blends an observed slider with the current value for gradual monthly adaptation.
 */
export const blendSlider = (observed: number, current: number, fallback: number): number => {
  if (observed === fallback && current === fallback) {
    return fallback;
  }
  const blended = ADAPTIVE_BLEND_WEIGHT * observed + (1 - ADAPTIVE_BLEND_WEIGHT) * current;
  return clampSlider(blended);
};

/**
 * Computes adaptive conversion sliders from prior-month pipeline activity and production.
 */
export const computeAdaptiveRatioSliders = (
  stageCounts: PipelineStageCounts,
  production: ProductionFunnelCounts,
  current: AdaptiveRatioSliders
): AdaptiveRatioSliders => {
  const get = (stage: string): number => stageCounts[stage] ?? 0;

  const coldObserved = observedConversionToSlider(
    get('Interview'),
    get('Initial Contact'),
    INDUSTRY_RATIO_SLIDERS.coldCallToInterview
  );
  const interviewObserved = observedConversionToSlider(
    get('Analysis'),
    get('Interview'),
    INDUSTRY_RATIO_SLIDERS.interviewToAnalysis
  );
  const analysisObserved = observedConversionToSlider(
    get('Recommendation'),
    get('Analysis'),
    INDUSTRY_RATIO_SLIDERS.analysisToRecommendation
  );
  const recommendationObserved = observedConversionToSlider(
    get('Implementation'),
    get('Recommendation'),
    INDUSTRY_RATIO_SLIDERS.recommendationToImplementation
  );
  const submissionObserved = observedConversionToSlider(
    production.issued,
    production.submitted,
    INDUSTRY_RATIO_SLIDERS.submissionToIssued
  );

  return {
    coldCallToInterviewRatio: blendSlider(
      coldObserved,
      current.coldCallToInterviewRatio,
      INDUSTRY_RATIO_SLIDERS.coldCallToInterview
    ),
    interviewToAnalysisRatio: blendSlider(
      interviewObserved,
      current.interviewToAnalysisRatio,
      INDUSTRY_RATIO_SLIDERS.interviewToAnalysis
    ),
    analysisToRecommendationRatio: blendSlider(
      analysisObserved,
      current.analysisToRecommendationRatio,
      INDUSTRY_RATIO_SLIDERS.analysisToRecommendation
    ),
    recommendationToImplementationRatio: blendSlider(
      recommendationObserved,
      current.recommendationToImplementationRatio,
      INDUSTRY_RATIO_SLIDERS.recommendationToImplementation
    ),
    submissionToIssuedRatio: blendSlider(
      submissionObserved,
      current.submissionToIssuedRatio,
      INDUSTRY_RATIO_SLIDERS.submissionToIssued
    ),
  };
};

/**
 * Returns YYYY-MM for the given date.
 */
export const formatMonthKey = (date: Date): string => date.toISOString().slice(0, 7);

/**
 * Returns inclusive-exclusive date range for the previous calendar month.
 */
export const getPreviousCalendarMonthRange = (
  reference: Date = new Date()
): { start: string; end: string } => {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const prevStart = new Date(Date.UTC(year, month - 1, 1));
  const prevEnd = new Date(Date.UTC(year, month, 1));
  return {
    start: prevStart.toISOString().slice(0, 10),
    end: prevEnd.toISOString().slice(0, 10),
  };
};

/**
 * Strips internal gross-target breakdown from planning output for client APIs.
 */
export const toPublicPlanningTargets = (targets: {
  weekly: WeeklyDeliverables;
  daily?: import('./planningEngine').DailyDeliverables;
  weeklyPointTarget: number;
}) => ({
  weekly: targets.weekly,
  daily: targets.daily,
  weeklyPointTarget: targets.weeklyPointTarget,
});
