/**
 * Setup completion group identifiers — extensible as onboarding grows.
 */
export type CompletionGroupId =
  | 'financial_profile'
  | 'contacts'
  | 'activities'
  | 'production';

export interface CompletionGroup {
  id: CompletionGroupId;
  title: string;
  description: string;
  completed: boolean;
}

export interface SetupCompletionSummary {
  completedCount: number;
  totalCount: number;
  percentComplete: number;
  groups: CompletionGroup[];
}
