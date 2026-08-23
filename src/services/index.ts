import { DataStore, buildProductionSummary, newId, PRODUCTION_GOAL } from '../data/store';
import { isDatabaseActive } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { assertDemoSelfServeRegistrationAllowed, assertDemoPasswordLoginAllowed, assertDemoAccountDeleteAllowed } from '../middleware/demoGuard';
import { env } from '../config/env';
import { organisationRepository } from '../repositories/organisation.repository';
import { userRepository } from '../repositories/user.repository';
import { contactRepository, ContactImportResult } from '../repositories/contact.repository';
import { productionRepository } from '../repositories/production.repository';
import { activityRepository } from '../repositories/activity.repository';
import { hashPassword, signToken, toUserDto, verifyPassword } from '../utils/auth';
import { generateVerificationPin, hashToken } from '../utils/emailTokens';
import { authTokenRepository } from '../repositories/authToken.repository';
import { sendPasswordResetEmail, sendVerificationEmail } from './emailService';
import type { ProductionDashboard } from '../repositories/productionDashboard.repository';
import { getInMemoryGeneralSettings, buildPlanningInputs } from './planning.service';
import { calculatePlanningTargets } from './planningEngine';
import {
  CreateActivityInput,
  UpdateActivityInput,
  CreateContactInput,
  UpdateContactInput,
  CreateProductionInput,
  UpdateProductionInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '../validators/schemas';
import { Contact, Production } from '../types';
import { isApplicationIncomeRecognized } from '../features/applicationStatus';
import { buildContactFingerprint } from '../utils/piiCrypto';
import { createLogger } from '../utils/logger';
import { subscriptionService } from './subscription.service';
import { organisationService } from './organisation.service';
import { caseService } from './case.service';
import {
  assertCanCreateRealContact,
  assertCanEditContact,
  assertCanImportContacts,
  activateContactSlot,
} from './entitlement.service';

const activityLog = createLogger('ActivityService');
const authLog = createLogger('AuthService');

/** In-memory fallback stores for email auth tokens when PostgreSQL is unavailable. */
const memoryEmailVerificationTokens = new Map<string, { userId: string; expiresAt: number }>();
const memoryPasswordResetTokens = new Map<string, { userId: string; expiresAt: number }>();

const VERIFICATION_PIN_TTL_MS = 30 * 60 * 1000;
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const GENERIC_RESET_MESSAGE =
  'If an account exists for that email, a reset code has been sent.';
const GENERIC_RESEND_MESSAGE =
  'If an account exists and is unverified, a new verification code has been sent.';

/**
 * Returns true when the advisor has confirmed their email address.
 */
const isEmailVerified = (user: { emailVerifiedAt?: string }): boolean =>
  Boolean(user.emailVerifiedAt);

/**
 * Adds company / role / permissions to a user DTO when PostgreSQL is available.
 */
const attachOrganisation = async (userId: string, dto: ReturnType<typeof toUserDto>) => {
  if (!isDatabaseActive()) {
    return dto;
  }
  try {
    const organisation = await organisationService.getMyOrganisation(userId);
    return { ...dto, organisation };
  } catch {
    return dto;
  }
};

/**
 * Authentication business logic — register, login, and session helpers.
 * Uses PostgreSQL when connected; falls back to in-memory store otherwise.
 */
export class AuthService {
  constructor(private store: DataStore) {}

  /**
   * Authenticates a user and returns a JWT plus public profile.
   */
  async login(input: LoginInput) {
    assertDemoPasswordLoginAllowed();
    const user = isDatabaseActive()
      ? await userRepository.findByEmail(input.email)
      : this.store.users.find(
          (entry) => entry.email.toLowerCase() === input.email.toLowerCase()
        ) ?? null;

    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    authLog.info('Login credentials valid', {
      email: user.email,
      userId: user.id,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
    });

    if (!isEmailVerified(user)) {
      throw new AppError(
        403,
        'Your email is not verified yet. Enter the 6-digit code we sent you.',
        'EMAIL_NOT_VERIFIED',
        { email: user.email }
      );
    }

    if (isDatabaseActive() && user.isActive === false) {
      throw new AppError(403, 'This account has been deactivated.', 'ACCOUNT_INACTIVE');
    }

    if (env.isDemoMode && isDatabaseActive()) {
      const membership = await organisationRepository.findMembership(user.id);
      if (membership?.is_platform_admin) {
        throw new AppError(403, 'Internal AdvisorTrack administration is not available in the public demo.', 'DEMO_PLATFORM_FORBIDDEN');
      }
    }

    if (isDatabaseActive()) {
      await userRepository.recordLastLogin(user.id);
    }

    const token = signToken({ userId: user.id, email: user.email });
    return { token, user: await attachOrganisation(user.id, toUserDto(user)) };
  }

  /**
   * Creates a new advisor account and sends a verification email.
   */
  async register(input: RegisterInput) {
    assertDemoSelfServeRegistrationAllowed();
    const passwordHash = await hashPassword(input.password);

    if (isDatabaseActive()) {
      const existing = await userRepository.findByEmail(input.email);
      if (existing) {
        throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
      }

      try {
        const user = await userRepository.create({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          passwordHash,
        });

        await subscriptionService.assignDefaultSubscription(user.id);
        authLog.info('Register complete — sending verification email', {
          userId: user.id,
          email: user.email,
        });
        const emailDelivered = await this.issueVerificationEmail(user);

        return {
          message: emailDelivered
            ? 'We sent a 6-digit verification code to your email.'
            : 'Account created, but we could not send the verification code yet. Tap resend on the next screen.',
          email: user.email,
          requiresVerification: true as const,
          emailDelivered,
        };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === '23505') {
          throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
        }
        throw error;
      }
    }

    const exists = this.store.users.some(
      (entry) => entry.email.toLowerCase() === input.email.toLowerCase()
    );

    if (exists) {
      throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
    }

    const user = {
      id: newId('user'),
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      role: 'Financial Advisor',
      createdAt: new Date().toISOString(),
      passwordHash,
    };

    this.store.users.push(user);
    await subscriptionService.assignDefaultSubscription(user.id);
    const emailDelivered = await this.issueVerificationEmail(user);

    return {
      message: emailDelivered
        ? 'We sent a 6-digit verification code to your email.'
        : 'Account created, but we could not send the verification code yet. Tap resend on the next screen.',
      email: user.email,
      requiresVerification: true as const,
      emailDelivered,
    };
  }

  /**
   * Confirms an advisor email address using the 6-digit PIN from email.
   */
  async verifyEmail(input: VerifyEmailInput) {
    const code = input.code.trim();
    const codeHash = hashToken(code);
    const now = Date.now();

    if (isDatabaseActive()) {
      const user = await userRepository.findByEmail(input.email);
      if (!user) {
        throw new AppError(400, 'Invalid or expired verification code', 'INVALID_TOKEN');
      }

      if (isEmailVerified(user)) {
        return { message: 'Email already verified. You can sign in.' };
      }

      const record = await authTokenRepository.findValidEmailVerificationToken(user.id, codeHash);
      if (!record) {
        throw new AppError(400, 'Invalid or expired verification code', 'INVALID_TOKEN');
      }

      await userRepository.markEmailVerified(user.id);
      await authTokenRepository.markEmailVerificationTokenUsed(record.id);
    } else {
      const user = this.store.users.find(
        (entry) => entry.email.toLowerCase() === input.email.toLowerCase()
      );
      if (!user) {
        throw new AppError(400, 'Invalid or expired verification code', 'INVALID_TOKEN');
      }

      if (isEmailVerified(user)) {
        return { message: 'Email already verified. You can sign in.' };
      }

      const record = memoryEmailVerificationTokens.get(codeHash);
      if (!record || record.userId !== user.id || record.expiresAt <= now) {
        throw new AppError(400, 'Invalid or expired verification code', 'INVALID_TOKEN');
      }

      user.emailVerifiedAt = new Date().toISOString();
      memoryEmailVerificationTokens.delete(codeHash);
    }

    return { message: 'Email verified successfully. You can now sign in.' };
  }

  /**
   * Sends another verification email when signup confirmation was missed.
   */
  async resendVerification(email: string) {
    const user = isDatabaseActive()
      ? await userRepository.findByEmail(email)
      : this.store.users.find(
          (entry) => entry.email.toLowerCase() === email.toLowerCase()
        ) ?? null;

    if (user && !isEmailVerified(user)) {
      await this.issueVerificationEmail(user);
    }

    return { message: GENERIC_RESEND_MESSAGE };
  }

  /**
   * Sends a password reset email when an account exists for the given address.
   */
  async forgotPassword(email: string) {
    const user = isDatabaseActive()
      ? await userRepository.findByEmail(email)
      : this.store.users.find(
          (entry) => entry.email.toLowerCase() === email.toLowerCase()
        ) ?? null;

    if (user) {
      await this.issuePasswordResetEmail(user);
    }

    return { message: GENERIC_RESET_MESSAGE };
  }

  /**
   * Sets a new password using the 6-digit reset PIN from email.
   */
  async resetPassword(input: ResetPasswordInput) {
    const code = input.code.trim();
    const codeHash = hashToken(code);
    const passwordHash = await hashPassword(input.password);
    const now = Date.now();

    if (isDatabaseActive()) {
      const user = await userRepository.findByEmail(input.email);
      if (!user) {
        throw new AppError(400, 'Invalid or expired reset code', 'INVALID_TOKEN');
      }

      const record = await authTokenRepository.findValidPasswordResetToken(user.id, codeHash);
      if (!record) {
        throw new AppError(400, 'Invalid or expired reset code', 'INVALID_TOKEN');
      }

      await userRepository.updatePassword(user.id, passwordHash);
      await authTokenRepository.markPasswordResetTokenUsed(record.id);
    } else {
      const user = this.store.users.find(
        (entry) => entry.email.toLowerCase() === input.email.toLowerCase()
      );
      if (!user) {
        throw new AppError(400, 'Invalid or expired reset code', 'INVALID_TOKEN');
      }

      const record = memoryPasswordResetTokens.get(codeHash);
      if (!record || record.userId !== user.id || record.expiresAt <= now) {
        throw new AppError(400, 'Invalid or expired reset code', 'INVALID_TOKEN');
      }

      user.passwordHash = passwordHash;
      memoryPasswordResetTokens.delete(codeHash);
    }

    return { message: 'Password updated successfully. You can now sign in.' };
  }

  /**
   * Creates and emails a 6-digit verification PIN for the given user.
   */
  private async issueVerificationEmail(user: {
    id: string;
    email: string;
    firstName: string;
  }): Promise<boolean> {
    const pin = generateVerificationPin();
    const tokenHash = hashToken(pin);
    const expiresAt = new Date(Date.now() + VERIFICATION_PIN_TTL_MS);

    if (isDatabaseActive()) {
      await authTokenRepository.createEmailVerificationToken(user.id, tokenHash, expiresAt);
    } else {
      memoryEmailVerificationTokens.set(tokenHash, {
        userId: user.id,
        expiresAt: expiresAt.getTime(),
      });
    }

    const delivered = await sendVerificationEmail(user.email, user.firstName, pin);
    if (delivered) {
      authLog.info('Verification PIN email dispatched', { userId: user.id, email: user.email });
    } else {
      authLog.warn('Verification PIN saved but email was not delivered', {
        userId: user.id,
        email: user.email,
        pin,
      });
    }
    return delivered;
  }

  /**
   * Creates and emails a 6-digit password reset PIN for the given user.
   */
  private async issuePasswordResetEmail(user: {
    id: string;
    email: string;
    firstName: string;
  }): Promise<boolean> {
    const pin = generateVerificationPin();
    const tokenHash = hashToken(pin);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

    if (isDatabaseActive()) {
      await authTokenRepository.createPasswordResetToken(user.id, tokenHash, expiresAt);
    } else {
      memoryPasswordResetTokens.set(tokenHash, {
        userId: user.id,
        expiresAt: expiresAt.getTime(),
      });
    }

    const delivered = await sendPasswordResetEmail(user.email, user.firstName, pin);
    if (delivered) {
      authLog.info('Password reset PIN email dispatched', { userId: user.id, email: user.email });
    } else {
      authLog.warn('Password reset PIN saved but email was not delivered', {
        userId: user.id,
        email: user.email,
        pin,
      });
    }
    return delivered;
  }

  /**
   * Returns the authenticated user's profile.
   */
  async getMe(userId: string) {
    const user = isDatabaseActive()
      ? await userRepository.findById(userId)
      : this.store.users.find((entry) => entry.id === userId) ?? null;

    if (!user) {
      throw new AppError(404, 'User not found', 'NOT_FOUND');
    }

    if (!isEmailVerified(user)) {
      throw new AppError(
        403,
        'Your email is not verified yet. Enter the 6-digit code we sent you.',
        'EMAIL_NOT_VERIFIED',
        { email: user.email }
      );
    }

    return attachOrganisation(userId, toUserDto(user));
  }

  /**
   * Permanently deletes the authenticated advisor account and cascaded data.
   */
  async deleteAccount(userId: string) {
    assertDemoAccountDeleteAllowed();
    if (isDatabaseActive()) {
      const deleted = await userRepository.deleteById(userId);
      if (!deleted) {
        throw new AppError(404, 'User not found', 'NOT_FOUND');
      }
      return { message: 'Account deleted' };
    }

    const index = this.store.users.findIndex((entry) => entry.id === userId);
    if (index < 0) {
      throw new AppError(404, 'User not found', 'NOT_FOUND');
    }
    this.store.users.splice(index, 1);
    return { message: 'Account deleted' };
  }
}

/**
 * Strips internal userId from contact API responses.
 */
const toPublicContact = ({ userId: _uid, ...contact }: Contact) => contact;

/**
 * Contact CRUD operations scoped to the authenticated user.
 */
export class ContactService {
  constructor(private store: DataStore) {}

  /**
   * Lists contacts for a user, optionally filtered by search query.
   */
  async list(userId: string, search?: string) {
    if (isDatabaseActive()) {
      const items = await contactRepository.listByUserId(userId, search);
      return items.map(toPublicContact);
    }

    let items = this.store.contacts.filter((contact) => contact.userId === userId);

    if (search?.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (contact) =>
          contact.firstName.toLowerCase().includes(q) ||
          contact.lastName.toLowerCase().includes(q) ||
          contact.email.toLowerCase().includes(q) ||
          contact.company?.toLowerCase().includes(q)
      );
    }

    return items.map(({ userId: _uid, ...contact }) => contact);
  }

  /**
   * Fetches a single contact belonging to the user.
   */
  async getById(userId: string, id: string) {
    if (isDatabaseActive()) {
      const contact = await contactRepository.findById(userId, id);
      if (!contact) {
        throw new AppError(404, 'Contact not found', 'NOT_FOUND');
      }
      return toPublicContact(contact);
    }

    const contact = this.store.contacts.find(
      (entry) => entry.id === id && entry.userId === userId
    );

    if (!contact) {
      throw new AppError(404, 'Contact not found', 'NOT_FOUND');
    }

    const { userId: _uid, ...dto } = contact;
    return dto;
  }

  /**
   * Creates a new contact for the user.
   */
  async create(userId: string, input: CreateContactInput) {
    if (isDatabaseActive()) {
      await assertCanCreateRealContact(userId);

      const contact = await contactRepository.create(userId, input, {
        importSource: 'manual',
        consentAccepted: Boolean(input.consentAccepted),
      });
      const contactName = `${contact.firstName} ${contact.lastName}`.trim();
      await caseService.createForNewContact(userId, contact.id, contactName);
      return toPublicContact(contact);
    }

    const contact = {
      id: newId('contact'),
      userId,
      ...input,
      lastName: input.lastName || '',
      email: input.email || '',
      phone: input.phone || '',
      isPractice: false,
      activationStatus: 'active' as const,
      createdAt: new Date().toISOString(),
    };

    this.store.contacts.push(contact);
    const { userId: _uid, ...dto } = contact;
    return dto;
  }

  /**
   * Bulk-imports contacts from the device address book (chunked by the client).
   */
  async batchImport(
    userId: string,
    inputs: CreateContactInput[],
    options: { popiaNoticeVersion?: string }
  ): Promise<ContactImportResult> {
    if (isDatabaseActive()) {
      await assertCanImportContacts(userId);

      return contactRepository.batchImport(userId, inputs, {
        importSource: 'device_import',
        consentAccepted: true,
        popiaNoticeVersion: options.popiaNoticeVersion,
      });
    }

    let imported = 0;
    let duplicates = 0;
    let skipped = 0;
    const seenFingerprints = new Set<string>();

    for (const input of inputs) {
      const fingerprint = buildContactFingerprint(input.email ?? '', input.phone ?? '');
      if (!fingerprint) {
        skipped += 1;
        continue;
      }
      if (seenFingerprints.has(fingerprint)) {
        duplicates += 1;
        continue;
      }
      seenFingerprints.add(fingerprint);

      const exists = this.store.contacts.some(
        (c) =>
          c.userId === userId &&
          buildContactFingerprint(c.email, c.phone) === fingerprint
      );
      if (exists) {
        duplicates += 1;
        continue;
      }

      this.store.contacts.push({
        id: newId('contact'),
        userId,
        ...input,
        lastName: input.lastName || '',
        email: input.email || '',
        phone: input.phone || '',
        isPractice: false,
        activationStatus: 'active',
        createdAt: new Date().toISOString(),
      });
      imported += 1;
    }

    return { imported, duplicates, skipped, total: inputs.length };
  }

  /**
   * Updates an existing contact belonging to the user.
   */
  async update(userId: string, id: string, input: UpdateContactInput) {
    if (isDatabaseActive()) {
      const existing = await contactRepository.findById(userId, id);
      if (!existing) {
        throw new AppError(404, 'Contact not found', 'NOT_FOUND');
      }

      await assertCanEditContact(userId, {
        isPractice: existing.isPractice,
        activationStatus: existing.activationStatus,
      });

      const contact = await contactRepository.update(userId, id, input);
      if (!contact) {
        throw new AppError(404, 'Contact not found', 'NOT_FOUND');
      }
      return toPublicContact(contact);
    }

    const index = this.store.contacts.findIndex(
      (entry) => entry.id === id && entry.userId === userId
    );
    if (index === -1) {
      throw new AppError(404, 'Contact not found', 'NOT_FOUND');
    }

    const existing = this.store.contacts[index];
    const updated = {
      ...existing,
      ...input,
      lastName: input.lastName ?? existing.lastName,
      email: input.email ?? existing.email,
      phone: input.phone ?? existing.phone,
    };
    this.store.contacts[index] = updated;
    const { userId: _uid, ...dto } = updated;
    return dto;
  }

  /**
   * Activates a real contact slot (Live Preview — swaps archived client into active).
   */
  async activateContact(userId: string, contactId: string) {
    if (!isDatabaseActive()) {
      return;
    }

    await activateContactSlot(userId, contactId);
    const contact = await contactRepository.findById(userId, contactId);
    if (!contact) {
      throw new AppError(404, 'Contact not found', 'NOT_FOUND');
    }
    return toPublicContact(contact);
  }

  /**
   * Deletes a contact belonging to the user.
   */
  async delete(userId: string, id: string) {
    if (isDatabaseActive()) {
      const deleted = await contactRepository.deleteById(userId, id);
      if (!deleted) {
        throw new AppError(404, 'Contact not found', 'NOT_FOUND');
      }
      return;
    }

    const index = this.store.contacts.findIndex(
      (entry) => entry.id === id && entry.userId === userId
    );
    if (index === -1) {
      throw new AppError(404, 'Contact not found', 'NOT_FOUND');
    }
    this.store.contacts.splice(index, 1);
  }

  /**
   * Returns POPIA audit log entries for the advisor (import accountability).
   */
  async getPopiaAudit(userId: string) {
    if (isDatabaseActive()) {
      return contactRepository.listPopiaAudit(userId);
    }
    return [];
  }
}

/**
 * Activity operations scoped to the authenticated user.
 */
export class ActivityService {
  constructor(private store: DataStore) {}

  /**
   * Lists activities, optionally filtered by date (YYYY-MM-DD prefix).
   */
  async list(userId: string, dateFilter?: string) {
    if (isDatabaseActive()) {
      const items = await activityRepository.listByUserId(userId, dateFilter);
      return items.map(({ userId: _uid, ...activity }) => activity);
    }

    let items = this.store.activities.filter((activity) => activity.userId === userId);

    if (dateFilter) {
      items = items.filter((activity) => activity.scheduledAt.startsWith(dateFilter));
    }

    return items.map(({ userId: _uid, ...activity }) => activity);
  }

  /**
   * Creates a new activity for the user.
   */
  async create(userId: string, input: CreateActivityInput) {
    activityLog.info('Creating activity', {
      userId,
      persistence: isDatabaseActive() ? 'postgresql' : 'in-memory',
      title: input.title,
      scheduledAt: input.scheduledAt,
    });

    if (isDatabaseActive()) {
      const activity = await activityRepository.create(userId, input);
      const { userId: _uid, ...dto } = activity;
      activityLog.info('Activity created in PostgreSQL', {
        userId,
        activityId: dto.id,
        scheduledAt: dto.scheduledAt,
      });
      return dto;
    }

    const activity = {
      id: newId('activity'),
      userId,
      ...input,
      createdAt: new Date().toISOString(),
    };

    this.store.activities.push(activity);
    activityLog.info('Activity created in memory store', {
      userId,
      activityId: activity.id,
      storeCount: this.store.activities.length,
    });
    const { userId: _uid, ...dto } = activity;
    return dto;
  }

  /**
   * Partially updates an activity (status, notes, title).
   * When notes change, appends a dated block to the linked contact's central record.
   */
  async update(userId: string, activityId: string, input: UpdateActivityInput) {
    if (isDatabaseActive()) {
      const before = await activityRepository.findByIdForUser(userId, activityId);
      const activity = await activityRepository.update(userId, activityId, input);
      if (!activity) {
        throw new AppError(404, 'Activity not found', 'NOT_FOUND');
      }

      const newNotes = input.description?.trim();
      const previousNotes = before?.description?.trim() ?? '';
      if (
        newNotes &&
        newNotes !== previousNotes &&
        before?.contactId &&
        /^[0-9a-f-]{36}$/i.test(before.contactId)
      ) {
        const contact = await contactRepository.findById(userId, before.contactId);
        if (contact) {
          const stamp = new Date().toISOString().slice(0, 10);
          const block = `— Activity notes (${stamp}): ${before.title}\n${newNotes}`;
          const existing = (contact.notes ?? '').trim();
          const merged = existing ? `${existing}\n\n${block}` : block;
          await contactRepository.update(userId, before.contactId, { notes: merged });
        }
      }

      const { userId: _uid, ...dto } = activity;
      return dto;
    }

    const index = this.store.activities.findIndex(
      (entry) => entry.id === activityId && entry.userId === userId
    );
    if (index < 0) {
      throw new AppError(404, 'Activity not found', 'NOT_FOUND');
    }

    const existing = this.store.activities[index];
    const updated = {
      ...existing,
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.description !== undefined ? { description: input.description || undefined } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
    };
    this.store.activities[index] = updated;
    const { userId: _uid, ...dto } = updated;
    return dto;
  }

  /**
   * Permanently deletes an activity for the user.
   */
  async delete(userId: string, activityId: string) {
    if (isDatabaseActive()) {
      const deleted = await activityRepository.delete(userId, activityId);
      if (!deleted) {
        throw new AppError(404, 'Activity not found', 'NOT_FOUND');
      }
      return { deleted: true };
    }

    const index = this.store.activities.findIndex(
      (entry) => entry.id === activityId && entry.userId === userId
    );
    if (index < 0) {
      throw new AppError(404, 'Activity not found', 'NOT_FOUND');
    }
    this.store.activities.splice(index, 1);
    return { deleted: true };
  }
}

/**
 * Production tracking operations scoped to the authenticated user.
 */
export class ProductionService {
  constructor(private store: DataStore) {}

  /**
   * Lists all production entries for the user.
   */
  list(userId: string) {
    return this.store.productions
      .filter((entry) => entry.userId === userId)
      .map(({ userId: _uid, ...production }) => production);
  }

  /**
   * Returns aggregated monthly production summary for dashboard charts.
   */
  summary(userId: string) {
    const items = this.store.productions.filter((entry) => entry.userId === userId);
    return buildProductionSummary(items);
  }

  /**
   * In-memory Production tab dashboard (development fallback).
   */
  dashboard(userId: string): ProductionDashboard {
    const items = this.store.productions.filter((entry) => entry.userId === userId);
    const monthPrefix = new Date().toISOString().slice(0, 7);
    const monthItems = items.filter((e) => e.date.startsWith(monthPrefix));

    const planning = calculatePlanningTargets(
      buildPlanningInputs(
        { monthlyGoalNett: PRODUCTION_GOAL, monthlyDeductions: 0, commissionSplit: '80%' },
        getInMemoryGeneralSettings(userId)
      )
    );

    const estimatedTotal = monthItems.reduce((s, e) => s + e.amount, 0);
    const issuedTotal = monthItems
      .filter((e) => (e as { isIssued?: boolean }).isIssued)
      .reduce((s, e) => s + e.amount, 0);
    const monthlyGoalNett = PRODUCTION_GOAL;

    const monthLabel = new Date().toLocaleDateString('en-ZA', {
      month: 'long',
      year: 'numeric',
    });

    const weeklySubmissions = monthItems.length;

    return {
      monthLabel,
      chart: [{ primary: monthItems.length, secondary: monthItems.length }],
      gauges: [
        {
          label: 'Cases Submitted',
          percent: Math.min(
            Math.round((weeklySubmissions / planning.weekly.casesSubmittedPerWeek) * 100),
            100
          ),
          color: 'blue',
        },
        {
          label: 'Potential Commission',
          percent:
            monthlyGoalNett > 0
              ? Math.min(Math.round((estimatedTotal / monthlyGoalNett) * 100), 100)
              : 0,
          color: 'green',
        },
        {
          label: 'Issued Commission',
          percent:
            monthlyGoalNett > 0
              ? Math.min(Math.round((issuedTotal / monthlyGoalNett) * 100), 100)
              : 0,
          color: 'blue',
        },
      ],
      entries: monthItems.map((entry) => {
        const isIssued = (entry as { isIssued?: boolean }).isIssued ?? false;
        const submittedAt = entry.date.slice(0, 10);
        return {
          id: entry.id,
          clientName: entry.contactName ?? entry.title,
          stage: 'Implementation',
          status: isIssued ? 'Issued' : 'Submitted',
          statusCategory: isIssued ? ('issued' as const) : ('submitted' as const),
          amount: entry.amount,
          tags: entry.productName ? [entry.productName] : [],
          completed: isIssued,
          dateGroup: new Date(entry.date).toLocaleDateString('en-ZA', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
          submittedAt,
        };
      }),
    };
  }

  /**
   * Creates a new production entry for the user.
   */
  async create(userId: string, input: CreateProductionInput) {
    if (isDatabaseActive()) {
      const entry = await productionRepository.create(userId, input);
      if (entry.contactId && isApplicationIncomeRecognized(entry.applicationStatus, entry.isIssued)) {
        await contactRepository.markAsClient(userId, entry.contactId);
      }
      return entry;
    }

    const production = {
      id: newId('production'),
      userId,
      title: input.title ?? `${input.pipelineStage ?? 'Production'} — ${input.contactName ?? 'Client'}`,
      type: input.type,
      amount: input.amount,
      contactId: input.contactId,
      contactName: input.contactName,
      productName: input.productName,
      date: input.date,
      notes: input.notes,
      isIssued: input.isIssued ?? false,
      createdAt: new Date().toISOString(),
    };

    this.store.productions.push(production);
    const { userId: _uid, ...dto } = production;
    return dto;
  }

  /**
   * Fetches a single production entry.
   */
  async getById(userId: string, entryId: string) {
    if (isDatabaseActive()) {
      const entry = await productionRepository.findByIdForUser(userId, entryId);
      if (!entry) {
        throw new AppError(404, 'Production entry not found', 'NOT_FOUND');
      }
      return entry;
    }

    const entry = this.store.productions.find(
      (item) => item.id === entryId && item.userId === userId
    );
    if (!entry) {
      throw new AppError(404, 'Production entry not found', 'NOT_FOUND');
    }
    const { userId: _uid, ...dto } = entry;
    return dto;
  }

  /**
   * Partially updates a production entry (e.g. issued toggle or full edit).
   */
  async update(userId: string, entryId: string, input: UpdateProductionInput) {
    if (isDatabaseActive()) {
      const entry = await productionRepository.update(userId, entryId, input);
      if (!entry) {
        throw new AppError(404, 'Production entry not found', 'NOT_FOUND');
      }
      if (entry.contactId && isApplicationIncomeRecognized(entry.applicationStatus, entry.isIssued)) {
        await contactRepository.markAsClient(userId, entry.contactId);
      }
      return entry;
    }

    const index = this.store.productions.findIndex(
      (item) => item.id === entryId && item.userId === userId
    );
    if (index < 0) {
      throw new AppError(404, 'Production entry not found', 'NOT_FOUND');
    }

    const existing = this.store.productions[index];
    const updated: Production = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
      ...(input.productName !== undefined ? { productName: input.productName } : {}),
      ...(input.isIssued !== undefined ? { isIssued: input.isIssued } : {}),
      ...(input.applicationStatus !== undefined
        ? { applicationStatus: input.applicationStatus }
        : input.isIssued
          ? { applicationStatus: 'accepted_issued' as const }
          : {}),
    };
    this.store.productions[index] = updated;
    const { userId: _uid, ...dto } = updated;
    return dto;
  }

  /**
   * Deletes a production entry.
   */
  async delete(userId: string, entryId: string) {
    if (isDatabaseActive()) {
      const deleted = await productionRepository.delete(userId, entryId);
      if (!deleted) {
        throw new AppError(404, 'Production entry not found', 'NOT_FOUND');
      }
      return { deleted: true };
    }

    const index = this.store.productions.findIndex(
      (item) => item.id === entryId && item.userId === userId
    );
    if (index < 0) {
      throw new AppError(404, 'Production entry not found', 'NOT_FOUND');
    }
    this.store.productions.splice(index, 1);
    return { deleted: true };
  }
}
