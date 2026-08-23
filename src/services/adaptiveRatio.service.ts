import { isDatabaseActive } from '../config/database';
import { activityRepository } from '../repositories/activity.repository';
import { generalSettingsRepository, GeneralSettings } from '../repositories/generalSettings.repository';
import { productionRepository } from '../repositories/production.repository';
import {
  computeAdaptiveRatioSliders,
  formatMonthKey,
  getPreviousCalendarMonthRange,
} from './adaptiveRatioEngine';

/**
 * Builds a partial settings patch respecting per-ratio manual overrides.
 */
const buildAdaptivePatch = (
  settings: GeneralSettings,
  computed: ReturnType<typeof computeAdaptiveRatioSliders>
): Partial<GeneralSettings> => {
  const patch: Partial<GeneralSettings> = {};

  if (!settings.coldCallToInterviewOverride) {
    patch.coldCallToInterviewRatio = computed.coldCallToInterviewRatio;
  }
  if (!settings.interviewToAnalysisOverride) {
    patch.interviewToAnalysisRatio = computed.interviewToAnalysisRatio;
  }
  if (!settings.analysisToRecommendationOverride) {
    patch.analysisToRecommendationRatio = computed.analysisToRecommendationRatio;
  }
  if (!settings.recommendationToImplementationOverride) {
    patch.recommendationToImplementationRatio = computed.recommendationToImplementationRatio;
  }
  if (!settings.submissionToIssuedOverride) {
    patch.submissionToIssuedRatio = computed.submissionToIssuedRatio;
  }

  return patch;
};

/**
 * Recalculates conversion ratios from prior-month activity when adaptive mode is enabled.
 */
export class AdaptiveRatioService {
  /**
   * Runs at most once per calendar month per advisor (skipped when disabled or already adjusted).
   */
  async ensureMonthlyAdjustment(userId: string): Promise<void> {
    if (!isDatabaseActive()) {
      return;
    }

    const settings = await generalSettingsRepository.findByUserId(userId);
    if (settings.adaptiveRatiosEnabled === false) {
      return;
    }

    const monthKey = formatMonthKey(new Date());
    if (settings.ratiosAdjustmentMonth === monthKey) {
      return;
    }

    const { start, end } = getPreviousCalendarMonthRange();
    const [stageCounts, production] = await Promise.all([
      activityRepository.countCompletedByStageBetween(userId, start, end),
      productionRepository.countSubmissionStatsBetween(userId, start, end),
    ]);

    const current = {
      coldCallToInterviewRatio: settings.coldCallToInterviewRatio,
      interviewToAnalysisRatio: settings.interviewToAnalysisRatio,
      analysisToRecommendationRatio: settings.analysisToRecommendationRatio,
      recommendationToImplementationRatio: settings.recommendationToImplementationRatio,
      submissionToIssuedRatio: settings.submissionToIssuedRatio,
    };

    const computed = computeAdaptiveRatioSliders(stageCounts, production, current);
    const ratioPatch = buildAdaptivePatch(settings, computed);

    await generalSettingsRepository.patch(userId, {
      ...ratioPatch,
      ratiosAdjustmentMonth: monthKey,
      ratiosLastAdjustedAt: new Date().toISOString(),
    });
  }
}

export const adaptiveRatioService = new AdaptiveRatioService();
