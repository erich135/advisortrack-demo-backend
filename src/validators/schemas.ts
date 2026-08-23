import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must include a letter')
    .regex(/\d/, 'Password must include a number'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Za-z]/, 'Password must include a letter')
    .regex(/\d/, 'Password must include a number'),
});

export const updateFinancialProfileSchema = z.object({
  monthlyGoalNett: z.number().min(0).optional(),
  monthlyDeductions: z.number().min(0).optional().nullable(),
  commissionSplit: z.string().max(255).optional().nullable(),
});

export const updateUserProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional().nullable(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional().nullable(),
  fspNumber: z.string().max(32).optional().nullable(),
  role: z.string().max(100).optional().nullable(),
  monthlyGoalNett: z.number().min(0).optional().nullable(),
  monthlyDeductions: z.number().min(0).optional().nullable(),
  commissionSplit: z.string().max(255).optional().nullable(),
  commissionAdvisorType: z.enum(['employee', 'independent']).optional().nullable(),
  vatRegistered: z.boolean().optional(),
  vatRatePercent: z.number().min(0).max(100).optional().nullable(),
});

export const conciergeGeneralSettingsSchema = z.object({
  avgCommissionAmount: z.number().positive(),
  coldCallToInterviewRatio: z.number().min(0).max(10),
  interviewToAnalysisRatio: z.number().min(0).max(10),
  analysisToRecommendationRatio: z.number().min(0).max(10),
  recommendationToImplementationRatio: z.number().min(0).max(10),
  submissionToIssuedRatio: z.number().min(0).max(10),
});

export const completeSetupSchema = z.object({
  monthlyGoalNett: z.number().positive(),
  monthlyDeductions: z.number().min(0).optional().nullable(),
  commissionSplit: z.string().max(255).optional().nullable(),
  commissionSplitNotes: z.string().max(255).optional().nullable(),
  commissionAdvisorType: z.enum(['employee', 'independent']).optional(),
  workingWeeksPerYear: z.number().int().min(40).max(52).optional(),
  workingDaysPerWeek: z.number().int().min(1).max(7).optional(),
  generalSettings: conciergeGeneralSettingsSchema,
  termsAccepted: z.literal(true, {
    errorMap: () => ({
      message: 'Terms of Service acceptance is required to complete setup',
    }),
  }),
  termsVersion: z.string().max(16).optional(),
});

export const createContactSchema = z
  .object({
    firstName: z.string().min(1),
    lastName: z.string().default(''),
    email: z.union([z.string().email(), z.literal('')]).optional().default(''),
    phone: z.string().optional().default(''),
    company: z.string().optional(),
    address: z.string().max(500).optional(),
    status: z.enum(['prospect', 'active', 'inactive', 'client']).default('prospect'),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    rating: z.number().min(0).max(5).default(3),
    notes: z.string().optional(),
    /** POPIA consent attestation for manual create (stored as consent_recorded_at). */
    consentAccepted: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.email?.trim() || data.phone?.trim()), {
    message: 'At least email or phone is required',
  });

/** Maximum contacts per import API request — client sends multiple batches for large imports. */
export const CONTACT_IMPORT_BATCH_SIZE = 50;

export const batchCreateContactsSchema = z.object({
  contacts: z.array(createContactSchema).min(1).max(CONTACT_IMPORT_BATCH_SIZE),
  consentAccepted: z.literal(true, {
    errorMap: () => ({
      message: 'POPIA consent is required before importing contacts',
    }),
  }),
  popiaNoticeVersion: z.string().max(16).optional(),
});

export const createActivitySchema = z.object({
  title: z.string().min(1),
  type: z.enum(['call', 'meeting', 'email', 'follow_up', 'presentation', 'other']),
  status: z.enum(['scheduled', 'completed', 'cancelled']).default('scheduled'),
  contactId: z.string().uuid().optional(),
  contactName: z.string().optional(),
  description: z.string().optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  pipelineStage: z
    .enum([
      'Initial Contact',
      'Interview',
      'Analysis',
      'Recommendation',
      'Implementation',
      'Review',
    ])
    .optional(),
});

export const createProductionSchema = z.object({
  title: z.string().min(1).optional(),
  type: z.enum(['commission', 'fee', 'bonus', 'renewal', 'other']).default('commission'),
  amount: z.number().positive(),
  contactId: z.string().uuid().optional(),
  contactName: z.string().optional(),
  productName: z.string().optional(),
  pipelineStage: z
    .enum([
      'Initial Contact',
      'Interview',
      'Analysis',
      'Recommendation',
      'Implementation',
      'Review',
    ])
    .optional(),
  tags: z
    .array(
      z.enum([
        'Estate Planning',
        'Life Cover',
        'Disability',
        'Dread Disease',
        'Retirement',
        'Savings',
        'Investments',
        'Short Term',
        'Medical Aid',
      ])
    )
    .default([]),
  isIssued: z.boolean().default(false),
  applicationStatus: z
    .enum([
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
    ])
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
  sourceActivityId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
});

export const updateGeneralSettingsSchema = z.object({
  avgCommissionOverride: z.boolean().optional(),
  avgCommissionAmount: z.number().positive().optional(),
  taxDirectiveOverride: z.boolean().optional(),
  taxRatePercent: z.number().min(0).max(100).optional(),
  coldCallToInterviewOverride: z.boolean().optional(),
  coldCallToInterviewRatio: z.number().min(0).max(10).optional(),
  interviewToAnalysisOverride: z.boolean().optional(),
  interviewToAnalysisRatio: z.number().min(0).max(10).optional(),
  analysisToRecommendationOverride: z.boolean().optional(),
  analysisToRecommendationRatio: z.number().min(0).max(10).optional(),
  recommendationToImplementationOverride: z.boolean().optional(),
  recommendationToImplementationRatio: z.number().min(0).max(10).optional(),
  adaptiveRatiosEnabled: z.boolean().optional(),
  ratiosLastAdjustedAt: z.string().optional(),
  ratiosAdjustmentMonth: z.string().max(7).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateFinancialProfileInput = z.infer<typeof updateFinancialProfileSchema>;
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CompleteSetupInput = z.infer<typeof completeSetupSchema>;
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = z
  .object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().optional(),
    email: z.union([z.string().email(), z.literal('')]).optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    status: z.enum(['prospect', 'active', 'inactive', 'client']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    rating: z.number().min(0).max(5).optional(),
    notes: z.string().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = z
  .object({
    status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
    description: z.string().optional(),
    title: z.string().min(1).optional(),
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });

export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export const activityOutcomeSchema = z.object({
  action: z.enum(['proceed', 'lost', 'complete']),
  lostReason: z.string().max(500).optional(),
  production: z
    .object({
      amount: z.number().positive(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      isIssued: z.boolean().optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
  /** When completing without scheduling the next activity, optionally advance the open client case. */
  advanceCase: z.boolean().optional(),
  /** Optional schedule for the next activity created by Proceed. */
  nextScheduledAt: z.string().datetime().optional(),
  /** Optional pipeline stage override for the next activity (defaults to next stage). */
  nextPipelineStage: z
    .enum([
      'Initial Contact',
      'Interview',
      'Analysis',
      'Recommendation',
      'Implementation',
      'Review',
    ])
    .optional(),
});

export type ActivityOutcomeInput = z.infer<typeof activityOutcomeSchema>;

export const updateProductionSchema = z
  .object({
    title: z.string().min(1).optional(),
    type: z.enum(['commission', 'fee', 'bonus', 'renewal', 'other']).optional(),
    amount: z.number().positive().optional(),
    contactId: z.string().uuid().optional(),
    contactName: z.string().optional(),
    productName: z.string().optional(),
    pipelineStage: z
      .enum([
        'Initial Contact',
        'Interview',
        'Analysis',
        'Recommendation',
        'Implementation',
        'Review',
      ])
      .optional(),
    tags: z
      .array(
        z.enum([
          'Estate Planning',
          'Life Cover',
          'Disability',
          'Dread Disease',
          'Retirement',
          'Savings',
          'Investments',
          'Short Term',
          'Medical Aid',
        ])
      )
      .optional(),
    isIssued: z.boolean().optional(),
    applicationStatus: z
      .enum([
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
      ])
      .optional()
      .nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(500).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });

export type UpdateProductionInput = z.infer<typeof updateProductionSchema>;
export type CreateProductionInput = z.infer<typeof createProductionSchema>;
export type UpdateGeneralSettingsInput = z.infer<typeof updateGeneralSettingsSchema>;

export const selectSubscriptionPackageSchema = z.object({
  packageSlug: z.string().min(1).max(64),
});

/** Platform staff: create a company (organisation) with optional seat limit. */
export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional(),
  seatLimit: z.number().int().positive().nullable().optional(),
});

/** Platform staff: patch company name, seats, or active flag. */
export const updateCompanySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    seatLimit: z.number().int().min(0).nullable().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });

const subscriptionNoteSchema = z.string().trim().max(500).optional();

/** Internal admin: set the purchased licence quantity for a customer. */
export const setPurchasedLicencesSchema = z.object({
  purchased: z.number().int().min(0).nullable(),
  reason: subscriptionNoteSchema,
});

/** Internal admin: add or reduce purchased licences by a positive quantity. */
export const adjustPurchasedLicencesSchema = z.object({
  quantity: z.number().int().positive(),
  reason: subscriptionNoteSchema,
});

/** Internal admin: update company commercial subscription fields. */
export const updateCompanySubscriptionSchema = z
  .object({
    packageSlug: z.string().min(1).max(64).optional(),
    billingInterval: z.enum(['month', 'year']).optional(),
    vatRegistered: z.boolean().optional(),
    vatRatePercent: z.number().min(0).max(100).optional().nullable(),
    billingContactUserId: z.string().uuid().nullable().optional(),
    billingContactName: z.string().max(200).nullable().optional(),
    billingContactEmail: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
    reason: subscriptionNoteSchema,
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });

export const companySubscriptionActionSchema = z.object({
  reason: subscriptionNoteSchema,
});

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

const invoiceLineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: z.union([z.string(), z.number()]),
    unitPriceCents: z.number().int().nonnegative().optional(),
    unitPrice: z.union([z.string(), z.number()]).optional(),
    discountCents: z.number().int().nonnegative().optional(),
    discount: z.union([z.string(), z.number()]).optional(),
    vatRatePercent: z.union([z.string(), z.number()]).optional(),
    lineSubtotalCents: z.number().int().optional(),
    lineVatCents: z.number().int().optional(),
    lineTotalCents: z.number().int().optional(),
  })
  .refine((line) => line.unitPriceCents != null || line.unitPrice != null, {
    message: 'Each line requires a unit price',
  });

const billingSnapshotSchema = z.object({
  registeredName: z.string().trim().min(1).max(200),
  tradingName: z.string().max(200).nullable().optional(),
  registrationNumber: z.string().max(64).nullable().optional(),
  vatRegistered: z.boolean(),
  vatNumber: z.string().max(32).nullable().optional(),
  billingContactName: z.string().max(200).nullable().optional(),
  billingEmail: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
  telephone: z.string().max(30).nullable().optional(),
  address: z.string().max(2000).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  province: z.string().max(100).nullable().optional(),
  postalCode: z.string().max(16).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
});

export const upsertBillingProfileSchema = billingSnapshotSchema.extend({
  vatRatePercent: z.number().min(0).max(100).nullable().optional(),
});

const invoiceTotalsClaimSchema = {
  subtotalCents: z.number().int().nonnegative().optional(),
  vatCents: z.number().int().nonnegative().optional(),
  totalCents: z.number().int().nonnegative().optional(),
};

export const createInvoiceSchema = z.object({
  companyId: z.string().uuid(),
  invoiceDate: isoDateSchema,
  dueDate: isoDateSchema,
  poReference: z.string().max(64).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  paymentTerms: z.string().max(4000).nullable().optional(),
  billing: billingSnapshotSchema.optional(),
  saveBillingProfile: z.boolean().optional(),
  lines: z.array(invoiceLineSchema).min(1),
  ...invoiceTotalsClaimSchema,
});

export const updateDraftInvoiceSchema = z
  .object({
    invoiceDate: isoDateSchema.optional(),
    dueDate: isoDateSchema.optional(),
    poReference: z.string().max(64).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    paymentTerms: z.string().max(4000).nullable().optional(),
    billing: billingSnapshotSchema.optional(),
    saveBillingProfile: z.boolean().optional(),
    lines: z.array(invoiceLineSchema).min(1).optional(),
    ...invoiceTotalsClaimSchema,
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });

export const markInvoicePaidSchema = z.object({
  paymentDate: isoDateSchema,
  note: z.string().trim().max(500).optional(),
});

export const invoiceActionNoteSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/** Company admin: create a custom-named role with optional permission keys. */
export const createCompanyRoleSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
});

/** Company admin: rename a role or replace its permission keys. */
export const updateCompanyRoleSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    permissions: z.array(z.string()).optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });

/** Company admin: assign a role and/or reporting manager to a member. */
export const updateCompanyMemberSchema = z
  .object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(30).optional().nullable(),
    roleId: z.string().uuid().optional(),
    reportsToUserId: z.string().uuid().nullable().optional(),
    regionId: z.string().uuid().nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });

/** Invite a member into the caller's company using the existing account model. */
export const createCompanyMemberSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().max(30).optional().nullable(),
  roleId: z.string().uuid(),
  reportsToUserId: z.string().uuid().nullable().optional(),
  regionId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
});

export const createCompanyRegionSchema = z.object({
  name: z.string().min(1).max(200),
  managerUserId: z.string().uuid().nullable().optional(),
});

export const updateCompanyRegionSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    managerUserId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });

export const createCompanyTeamSchema = z.object({
  name: z.string().min(1).max(200),
  regionId: z.string().uuid(),
  leaderUserId: z.string().uuid().nullable().optional(),
});

export const updateCompanyTeamSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    regionId: z.string().uuid().optional(),
    leaderUserId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'At least one field is required',
  });

export type SelectSubscriptionPackageInput = z.infer<typeof selectSubscriptionPackageSchema>;

const pipelineStageSchema = z.enum([
  'Initial Contact',
  'Interview',
  'Analysis',
  'Recommendation',
  'Implementation',
  'Review',
]);

export const createCaseSchema = z.object({
  contactId: z.string().uuid(),
  currentStage: pipelineStageSchema.optional(),
  title: z.string().max(255).optional(),
});

const analysisQuoteSchema = z.object({
  productType: z.string().max(64).optional(),
  insurer: z.string().max(64).optional(),
  premium: z.number().min(0).optional(),
  commission: z.number().min(0).optional(),
});

export const updateCaseSchema = z
  .object({
    currentStage: pipelineStageSchema.optional(),
    status: z.enum(['open', 'won', 'lost', 'closed']).optional(),
    title: z.string().max(255).optional(),
    ficaIdReceived: z.boolean().optional(),
    ficaResidenceReceived: z.boolean().optional(),
    ficaBankReceived: z.boolean().optional(),
    ficaSkipAcknowledged: z.boolean().optional(),
    consentSentAt: z.string().datetime().optional().nullable(),
    factFindMode: z.enum(['simple_goal', 'full_fna']).optional().nullable(),
    simpleGoalProduct: z.string().max(64).optional().nullable(),
    simpleGoalAmount: z.number().min(0).optional().nullable(),
    maritalStatus: z.string().max(32).optional().nullable(),
    dependentsNotes: z.string().max(2000).optional().nullable(),
    fixedAssetsTotal: z.number().min(0).optional().nullable(),
    nonFixedAssetsTotal: z.number().min(0).optional().nullable(),
    investmentsTotal: z.number().min(0).optional().nullable(),
    liabilitiesTotal: z.number().min(0).optional().nullable(),
    savingsMonthly: z.number().min(0).optional().nullable(),
    employerBenefitsNotes: z.string().max(2000).optional().nullable(),
    businessInterestsNotes: z.string().max(2000).optional().nullable(),
    retirementFundsNotes: z.string().max(2000).optional().nullable(),
    lifeCoverNotes: z.string().max(2000).optional().nullable(),
    estatePlanningNotes: z.string().max(2000).optional().nullable(),
    quotesRequestedNotes: z.string().max(2000).optional().nullable(),
    analysisQuotes: z.array(analysisQuoteSchema).max(3).optional(),
    nextStepDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    /** Full ISO datetime for the synced Activities calendar entry (date + time). */
    nextStepScheduledAt: z.string().datetime().optional().nullable(),
    monthlyIncome: z.number().min(0).optional().nullable(),
    monthlyExpenses: z.number().min(0).optional().nullable(),
    financialGoals: z.string().max(2000).optional().nullable(),
    riskProfile: z.string().max(32).optional().nullable(),
    factFindNotes: z.string().max(2000).optional().nullable(),
    quoteProductType: z.string().max(64).optional().nullable(),
    chosenInsurer: z.string().max(64).optional().nullable(),
    quotePremium: z.number().min(0).optional().nullable(),
    estimatedCommission: z.number().min(0).optional().nullable(),
    replacementAdviceRequired: z.boolean().optional(),
    replacementAdviceConfirmed: z.boolean().optional(),
    clientApproved: z.boolean().optional().nullable(),
    reviewDueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    acknowledgeFicaIncomplete: z.boolean().optional(),
    submitToProduction: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });

export const createCaseDocumentSchema = z.object({
  documentType: z.string().max(64).default('other'),
  label: z.string().min(1).max(255),
  notes: z.string().max(500).optional(),
});

export const updateCaseDocumentSchema = z
  .object({
    markSent: z.boolean().optional(),
    markReceived: z.boolean().optional(),
    sentAt: z.string().datetime().optional().nullable(),
    receivedAt: z.string().datetime().optional().nullable(),
    notes: z.string().max(500).optional().nullable(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field is required',
  });

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;
export type CreateCaseDocumentInput = z.infer<typeof createCaseDocumentSchema>;
export type UpdateCaseDocumentInput = z.infer<typeof updateCaseDocumentSchema>;
