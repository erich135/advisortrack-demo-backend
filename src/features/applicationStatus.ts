/**
 * Application lifecycle statuses between submission and policy issued.
 */
export const APPLICATION_STATUSES = [
  'application_received',
  'quality_assessment',
  'pending_underwriting',
  'awaiting_medicals',
  'pma_pending',
  'awaiting_advisor_info',
  'counter_offer',
  'accepted_issued',
  'postponed',
  'declined',
  'withdrawn',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  application_received: 'Application received',
  quality_assessment: 'Quality assessment',
  pending_underwriting: 'Pending underwriting',
  awaiting_medicals: 'Awaiting medicals',
  pma_pending: 'PMA pending',
  awaiting_advisor_info: 'Awaiting advisor information',
  counter_offer: 'Counter-offer made',
  accepted_issued: 'Accepted / Issued',
  postponed: 'Postponed',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

/**
 * Returns true when commission should count as issued income.
 */
export const isApplicationIncomeRecognized = (
  applicationStatus: string | null | undefined,
  isIssued: boolean
): boolean =>
  isIssued || applicationStatus === 'accepted_issued';
