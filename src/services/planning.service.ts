import { financialProfileRepository } from '../repositories/financialProfile.repository';
import { generalSettingsRepository, GeneralSettings } from '../repositories/generalSettings.repository';
import { adaptiveRatioService } from './adaptiveRatio.service';
import { toPublicPlanningTargets } from './adaptiveRatioEngine';
import {
  calculatePlanningTargets,
  getMarginalTaxRateForNett,
  parseCommissionSplit,
  PlanningInputs,
  sliderToRatio,
} from './planningEngine';

const DEFAULT_MONTHLY_GOAL = 50000;

/** Client-safe planning output — gross target is intentionally omitted. */
export interface PublicPlanningTargets {
  weekly: import('./planningEngine').WeeklyDeliverables;
  daily?: import('./planningEngine').DailyDeliverables;
  weeklyPointTarget: number;
}

/**
 * In-memory general settings for development without PostgreSQL.
 */
const memoryGeneralSettings = new Map<string, GeneralSettings>();

/**
 * Resolves planning inputs from financial profile + general settings.
 */
export const buildPlanningInputs = (
  financial: {
    monthlyGoalNett?: number;
    monthlyDeductions?: number;
    commissionSplit?: string;
    workingWeeksPerYear?: number;
    workingDaysPerWeek?: number;
  },
  settings: GeneralSettings
): PlanningInputs => {
  const monthlyGoalNett = financial.monthlyGoalNett ?? DEFAULT_MONTHLY_GOAL;
  const monthlyDeductions = financial.monthlyDeductions ?? 0;
  const commissionSplit = parseCommissionSplit(financial.commissionSplit);

  const effectiveTaxRate = settings.taxDirectiveOverride
    ? settings.taxRatePercent / 100
    : getMarginalTaxRateForNett(monthlyGoalNett);

  const avgCommission = settings.avgCommissionAmount;

  return {
    monthlyGoalNett,
    monthlyDeductions,
    commissionSplit,
    effectiveTaxRate,
    avgCommission,
    ratios: {
      coldCallToInterview: sliderToRatio(settings.coldCallToInterviewRatio),
      interviewToAnalysis: sliderToRatio(settings.interviewToAnalysisRatio),
      analysisToRecommendation: sliderToRatio(settings.analysisToRecommendationRatio),
      recommendationToImplementation: sliderToRatio(settings.recommendationToImplementationRatio),
      submissionToIssued: sliderToRatio(settings.submissionToIssuedRatio),
    },
    workingWeeksPerYear: financial.workingWeeksPerYear ?? 44,
    workingDaysPerWeek: financial.workingDaysPerWeek ?? 5,
  };
};

/**
 * In-memory general settings fallback keyed by user ID.
 */
export const getInMemoryGeneralSettings = (userId: string): GeneralSettings => {
  if (!memoryGeneralSettings.has(userId)) {
    const now = new Date().toISOString();
    memoryGeneralSettings.set(userId, {
      userId,
      avgCommissionOverride: false,
      avgCommissionAmount: 10000,
      taxDirectiveOverride: false,
      taxRatePercent: 23,
      coldCallToInterviewOverride: false,
      coldCallToInterviewRatio: 4,
      interviewToAnalysisOverride: false,
      interviewToAnalysisRatio: 6,
      analysisToRecommendationOverride: false,
      analysisToRecommendationRatio: 6,
      recommendationToImplementationOverride: false,
      recommendationToImplementationRatio: 6,
      submissionToIssuedOverride: false,
      submissionToIssuedRatio: 8,
      adaptiveRatiosEnabled: true,
      createdAt: now,
      updatedAt: now,
    });  }
  return memoryGeneralSettings.get(userId)!;
};

/**
 * Loads advisor settings and computes Excel-based planning targets.
 */
export class PlanningService {
  /**
   * Returns weekly deliverables and point targets (gross target is never exposed to clients).
   */
  async getTargets(userId: string): Promise<PublicPlanningTargets> {
    await adaptiveRatioService.ensureMonthlyAdjustment(userId);

    const financial = await financialProfileRepository.findByUserId(userId);
    const settings = await generalSettingsRepository.findByUserId(userId);

    const inputs = buildPlanningInputs(
      {
        monthlyGoalNett: financial?.monthlyGoalNett,
        monthlyDeductions: financial?.monthlyDeductions,
        commissionSplit: financial?.commissionSplit,
        workingWeeksPerYear: financial?.workingWeeksPerYear,
        workingDaysPerWeek: financial?.workingDaysPerWeek,
      },
      settings
    );

    return toPublicPlanningTargets(calculatePlanningTargets(inputs));
  }
  /**
   * Returns general settings for the General Settings screen.
   */
  async getGeneralSettings(userId: string): Promise<GeneralSettings> {
    return generalSettingsRepository.findByUserId(userId);
  }

  /**
   * Updates general settings overrides and conversion ratios.
   */
  async updateGeneralSettings(
    userId: string,
    input: Partial<Omit<GeneralSettings, 'userId' | 'createdAt' | 'updatedAt'>>
  ): Promise<GeneralSettings> {
    return generalSettingsRepository.patch(userId, input);
  }
}
