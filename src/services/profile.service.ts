import { isDatabaseActive } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { financialProfileRepository, FinancialProfile } from '../repositories/financialProfile.repository';
import { generalSettingsRepository } from '../repositories/generalSettings.repository';
import { userRepository } from '../repositories/user.repository';
import { toUserDto } from '../utils/auth';
import { User } from '../types';
import {
  CompleteSetupInput,
  UpdateFinancialProfileInput,
  UpdateProfileInput,
} from '../validators/schemas';

/** In-memory fallback when PostgreSQL is unavailable. */
const memoryProfiles = new Map<string, FinancialProfile>();

export interface AdvisorProfile {
  user: User;
  financial: FinancialProfile;
}

/**
 * Profile & financial setup business logic.
 */
export class ProfileService {
  /**
   * Returns combined user identity + financial profile for Edit Profile screen.
   */
  async getAdvisorProfile(userId: string): Promise<AdvisorProfile> {
    if (isDatabaseActive()) {
      const user = await userRepository.findById(userId);
      if (!user) {
        throw new AppError(404, 'User not found', 'NOT_FOUND');
      }

      const financial = await financialProfileRepository.findByUserId(userId);
      if (!financial) {
        throw new AppError(404, 'Financial profile not found', 'NOT_FOUND');
      }

      return { user: toUserDto(user), financial };
    }

    const financial =
      memoryProfiles.get(userId) ?? {
        userId,
        needsSetup: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

    return {
      user: {
        id: userId,
        firstName: 'Advisor',
        lastName: '',
        email: '',
        createdAt: new Date().toISOString(),
      },
      financial,
    };
  }

  /**
   * Returns the advisor financial profile and whether setup is still needed.
   */
  async getFinancialProfile(userId: string): Promise<FinancialProfile> {
    const { financial } = await this.getAdvisorProfile(userId);
    return financial;
  }

  /**
   * Updates user identity and financial fields from Edit Profile.
   */
  async updateAdvisorProfile(userId: string, input: UpdateProfileInput): Promise<AdvisorProfile> {
    if (isDatabaseActive()) {
      const userPatch: Parameters<typeof userRepository.updateProfile>[1] = {};
      if (input.firstName !== undefined) userPatch.firstName = input.firstName;
      if (input.lastName !== undefined) userPatch.lastName = input.lastName;
      if (input.email !== undefined) userPatch.email = input.email;
      if (input.phone !== undefined) userPatch.phone = input.phone;
      if (input.fspNumber !== undefined) userPatch.fspNumber = input.fspNumber;
      if (input.role !== undefined) userPatch.role = input.role;

      const financialPatch: Parameters<typeof financialProfileRepository.patch>[1] = {};
      if (input.monthlyGoalNett !== undefined) {
        financialPatch.monthlyGoalNett = input.monthlyGoalNett ?? undefined;
      }
      if (input.monthlyDeductions !== undefined) {
        financialPatch.monthlyDeductions = input.monthlyDeductions;
      }
      if (input.commissionSplit !== undefined) {
        financialPatch.commissionSplit = input.commissionSplit;
      }
      if (input.commissionAdvisorType !== undefined) {
        financialPatch.commissionAdvisorType = input.commissionAdvisorType;
      }
      if (input.vatRegistered !== undefined) {
        financialPatch.vatRegistered = input.vatRegistered;
      }
      if (input.vatRatePercent !== undefined) {
        financialPatch.vatRatePercent = input.vatRatePercent;
      }

      const user =
        Object.keys(userPatch).length > 0
          ? await userRepository.updateProfile(userId, userPatch)
          : await userRepository.findById(userId);

      if (!user) {
        throw new AppError(404, 'User not found', 'NOT_FOUND');
      }

      const financial =
        Object.keys(financialPatch).length > 0
          ? await financialProfileRepository.patch(userId, financialPatch)
          : await financialProfileRepository.findByUserId(userId);

      if (!financial) {
        throw new AppError(404, 'Financial profile not found', 'NOT_FOUND');
      }

      return { user: toUserDto(user), financial };
    }

    const current = await this.getAdvisorProfile(userId);
    const updatedFinancial: FinancialProfile = {
      ...current.financial,
      monthlyGoalNett: input.monthlyGoalNett ?? current.financial.monthlyGoalNett,
      monthlyDeductions:
        input.monthlyDeductions !== undefined
          ? input.monthlyDeductions ?? undefined
          : current.financial.monthlyDeductions,
      commissionSplit:
        input.commissionSplit !== undefined
          ? input.commissionSplit ?? undefined
          : current.financial.commissionSplit,
      needsSetup: (input.monthlyGoalNett ?? current.financial.monthlyGoalNett) == null,
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(userId, updatedFinancial);

    return {
      user: {
        ...current.user,
        firstName: input.firstName ?? current.user.firstName,
        lastName: input.lastName ?? current.user.lastName,
        email: input.email ?? current.user.email,
        phone: input.phone ?? current.user.phone,
      },
      financial: updatedFinancial,
    };
  }

  /**
   * Partially updates financial profile fields.
   */
  async updateFinancialProfile(
    userId: string,
    input: UpdateFinancialProfileInput
  ): Promise<FinancialProfile> {
    if (isDatabaseActive()) {
      return financialProfileRepository.patch(userId, input);
    }

    const current = await this.getFinancialProfile(userId);
    const updated: FinancialProfile = {
      ...current,
      ...input,
      monthlyDeductions: input.monthlyDeductions ?? current.monthlyDeductions,
      commissionSplit: input.commissionSplit ?? current.commissionSplit,
      needsSetup: (input.monthlyGoalNett ?? current.monthlyGoalNett) == null,
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(userId, updated);
    return updated;
  }

  /**
   * Completes the setup concierge — financial profile, planning settings, and terms acceptance.
   */
  async completeSetup(userId: string, input: CompleteSetupInput): Promise<FinancialProfile> {
    if (isDatabaseActive()) {
      const profile = await financialProfileRepository.completeSetup(userId, {
        monthlyGoalNett: input.monthlyGoalNett,
        monthlyDeductions: input.monthlyDeductions,
        commissionSplit: input.commissionSplit,
        commissionSplitNotes: input.commissionSplitNotes,
        commissionAdvisorType: input.commissionAdvisorType ?? null,
        workingWeeksPerYear: input.workingWeeksPerYear,
        workingDaysPerWeek: input.workingDaysPerWeek,
      });

      const gs = input.generalSettings;
      await generalSettingsRepository.patch(userId, {
        avgCommissionOverride: true,
        avgCommissionAmount: gs.avgCommissionAmount,
        coldCallToInterviewOverride: true,
        coldCallToInterviewRatio: gs.coldCallToInterviewRatio,
        interviewToAnalysisOverride: true,
        interviewToAnalysisRatio: gs.interviewToAnalysisRatio,
        analysisToRecommendationOverride: true,
        analysisToRecommendationRatio: gs.analysisToRecommendationRatio,
        recommendationToImplementationOverride: true,
        recommendationToImplementationRatio: gs.recommendationToImplementationRatio,
        submissionToIssuedOverride: true,
        submissionToIssuedRatio: gs.submissionToIssuedRatio,
      });

      await userRepository.recordTermsAcceptance(
        userId,
        input.termsVersion ?? '2026-06'
      );

      return profile;
    }

    const updated: FinancialProfile = {
      userId,
      monthlyGoalNett: input.monthlyGoalNett,
      monthlyDeductions: input.monthlyDeductions ?? undefined,
      commissionSplit: input.commissionSplit ?? undefined,
      setupCompletedAt: new Date().toISOString(),
      needsSetup: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryProfiles.set(userId, updated);
    return updated;
  }
}
