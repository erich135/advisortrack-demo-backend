import { isDatabaseActive } from '../config/database';
import { financialProfileRepository } from '../repositories/financialProfile.repository';
import { contactRepository } from '../repositories/contact.repository';
import { productionRepository } from '../repositories/production.repository';
import { activityRepository } from '../repositories/activity.repository';
import { CompletionGroup, SetupCompletionSummary } from '../types/completion';
import { DataStore } from '../data/store';
import { ProfileService } from './profile.service';
import { hasPracticeContactsIntro } from './entitlement.service';

/**
 * Computes onboarding completion groups for the advisor setup checklist.
 */
export class CompletionService {
  constructor(
    private store: DataStore,
    private profileService: ProfileService
  ) {}

  /**
   * Returns grouped completion status for profile, contacts, activities, and production.
   */
  async getSummary(userId: string): Promise<SetupCompletionSummary> {
    const financial = await this.profileService.getFinancialProfile(userId);

    let contactsCompleted: boolean;
    let activityCount: number;
    let productionCount: number;

    if (isDatabaseActive()) {
      const [realContactCount, practiceIntroDone] = await Promise.all([
        contactRepository.countNonPracticeByUserId(userId),
        hasPracticeContactsIntro(userId),
      ]);
      contactsCompleted = realContactCount > 0 || practiceIntroDone;
      productionCount = await productionRepository.countByUserId(userId);
      activityCount = await activityRepository.countByUserId(userId);

      const dbFinancial = await financialProfileRepository.findByUserId(userId);
      if (dbFinancial) {
        financial.needsSetup = dbFinancial.needsSetup;
      }
    } else {
      const userContacts = this.store.contacts.filter((c) => c.userId === userId);
      contactsCompleted = userContacts.some((c) => !c.isPractice);
      activityCount = this.store.activities.filter((a) => a.userId === userId).length;
      productionCount = this.store.productions.filter((p) => p.userId === userId).length;
    }

    const groups: CompletionGroup[] = [
      {
        id: 'financial_profile',
        title: 'Financial profile',
        description:
          'Set your monthly target, commission split, planning ratios, and accept terms in the setup concierge.',
        completed: !financial.needsSetup,
      },
      {
        id: 'contacts',
        title: 'Contacts',
        description:
          'Add practice clients to learn the workflow, or import real clients when you upgrade.',
        completed: contactsCompleted,
      },
      {
        id: 'activities',
        title: 'Activities',
        description: 'Schedule calls and meetings — these drive your weekly stats.',
        completed: activityCount > 0,
      },
      {
        id: 'production',
        title: 'Production',
        description: 'Log your first case or commission entry.',
        completed: productionCount > 0,
      },
    ];

    const completedCount = groups.filter((g) => g.completed).length;
    const totalCount = groups.length;

    return {
      completedCount,
      totalCount,
      percentComplete: totalCount === 0 ? 100 : Math.round((completedCount / totalCount) * 100),
      groups,
    };
  }
}
