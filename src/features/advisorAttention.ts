import { ManagementPipelineCase } from '../repositories/managementPipeline.repository';

export const STALLED_AFTER_DAYS = 7;
export const MOBILE_INACTIVE_AFTER_DAYS = 3;

const MS_PER_DAY = 86_400_000;

export const daysBetween = (fromIso: string, now: Date = new Date()): number =>
  Math.floor((now.getTime() - new Date(fromIso).getTime()) / MS_PER_DAY);

export const isOpenCase = (clientCase: Pick<ManagementPipelineCase, 'status'>): boolean =>
  clientCase.status === 'open';

export const isStalledOpenCase = (
  clientCase: Pick<ManagementPipelineCase, 'status' | 'lastUpdatedAt'>,
  now: Date = new Date()
): boolean =>
  isOpenCase(clientCase) && daysBetween(clientCase.lastUpdatedAt, now) >= STALLED_AFTER_DAYS;

export const isMissingDocuments = (
  clientCase: Pick<ManagementPipelineCase, 'status' | 'fica' | 'documents'>
): boolean => {
  if (!isOpenCase(clientCase)) return false;
  const documentsIncomplete =
    clientCase.documents.totalCount > 0 &&
    clientCase.documents.receivedCount < clientCase.documents.totalCount;
  const ficaIncomplete =
    !clientCase.fica.skipAcknowledged &&
    (!clientCase.fica.idReceived ||
      !clientCase.fica.residenceReceived ||
      !clientCase.fica.bankReceived);
  return documentsIncomplete || ficaIncomplete;
};

export const hasNoNextAction = (
  clientCase: Pick<ManagementPipelineCase, 'status' | 'nextStepDate' | 'nextScheduledActivity'>
): boolean =>
  isOpenCase(clientCase) &&
  !clientCase.nextStepDate &&
  !clientCase.nextScheduledActivity;

export type AttentionReason = {
  code: 'mobile_inactive' | 'stalled' | 'missing_documents' | 'no_next_action';
  label: string;
};

/**
 * Deterministic Needs Attention reasons. NULL lastMobileActivityAt is not inactivity.
 */
export const buildAttentionReasons = (input: {
  lastMobileActivityAt: string | null;
  stalledCount: number;
  missingDocumentsCount: number;
  noNextActionCount: number;
  now?: Date;
}): AttentionReason[] => {
  const reasons: AttentionReason[] = [];
  if (input.lastMobileActivityAt) {
    const inactiveDays = daysBetween(input.lastMobileActivityAt, input.now ?? new Date());
    if (inactiveDays >= MOBILE_INACTIVE_AFTER_DAYS) {
      reasons.push({
        code: 'mobile_inactive',
        label: `No mobile activity for ${inactiveDays} day${inactiveDays === 1 ? '' : 's'}`,
      });
    }
  }
  if (input.stalledCount > 0) {
    reasons.push({
      code: 'stalled',
      label: `${input.stalledCount} case${input.stalledCount === 1 ? '' : 's'} stalled 7+ days`,
    });
  }
  if (input.missingDocumentsCount > 0) {
    reasons.push({
      code: 'missing_documents',
      label: `${input.missingDocumentsCount} case${input.missingDocumentsCount === 1 ? '' : 's'} missing documents`,
    });
  }
  if (input.noNextActionCount > 0) {
    reasons.push({
      code: 'no_next_action',
      label: `${input.noNextActionCount} active case${input.noNextActionCount === 1 ? '' : 's'} with no next action`,
    });
  }
  return reasons;
};
