/**
 * Shared API types aligned with the Expo app models in advisor_track/src/models.
 */

export type ContactPriority = 'low' | 'medium' | 'high';
export type ContactStatus = 'prospect' | 'active' | 'inactive' | 'client';

export type ContactActivationStatus = 'active' | 'archived';

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  company?: string;
  role?: string;
  avatarUrl?: string;
  fspNumber?: string;
  /** True after the advisor finishes or skips the interactive guided tour. */
  completedGuidedTour?: boolean;
  /** Set after the advisor confirms their email address. */
  emailVerifiedAt?: string;
  /** False when a manager has deactivated the account. */
  isActive?: boolean;
  createdAt: string;
}

export interface UserRecord extends User {
  passwordHash: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company?: string;
  status: ContactStatus;
  priority: ContactPriority;
  rating: number;
  notes?: string;
  lastContactedAt?: string;
  consentRecordedAt?: string;
  importSource?: string;
  popiaNoticeVersion?: string;
  isPractice: boolean;
  activationStatus: ContactActivationStatus;
  createdAt: string;
  userId: string;
}

export type ActivityType = 'call' | 'meeting' | 'email' | 'follow_up' | 'presentation' | 'other';
export type ActivityStatus = 'scheduled' | 'completed' | 'cancelled';

export type ActivityOutcome = 'proceeded' | 'lost' | 'completed';

export interface Activity {
  id: string;
  title: string;
  type: ActivityType;
  status: ActivityStatus;
  pipelineStage?: string;
  outcome?: ActivityOutcome;
  lostReason?: string;
  sourceActivityId?: string;
  contactId?: string;
  contactName?: string;
  description?: string;
  scheduledAt: string;
  durationMinutes?: number;
  createdAt: string;
  userId: string;
}

export type ProductionType = 'commission' | 'fee' | 'bonus' | 'renewal' | 'other';

export interface Production {
  id: string;
  title: string;
  type: ProductionType;
  amount: number;
  contactId?: string;
  contactName?: string;
  productName?: string;
  date: string;
  notes?: string;
  isIssued?: boolean;
  createdAt: string;
  userId: string;
}

export interface ProductionSummary {
  month: string;
  total: number;
  goal: number;
  byType: Record<ProductionType, number>;
}

export interface AuthTokenPayload {
  userId: string;
  email: string;
  /** Present only for public-demo JWTs. Validated against demo_sessions server-side. */
  demoSessionId?: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}
