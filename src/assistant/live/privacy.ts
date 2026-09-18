import { getPipelineStageLabel } from '../../features/pipelineStages';
import { ASSISTANT_PERIOD_TIMEZONE } from './period';
import { fieldPermitted } from './policy';
import { sanitizeIdentityText } from './sanitizeDisplay';
import type {
  DirectoryPerson,
  PersonSummaryProjection,
  PipelineAggregate,
  PipelineSummaryProjection,
  ToolExecutionContext,
} from './types';

const LAST_MOBILE_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: ASSISTANT_PERIOD_TIMEZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

export function formatLastMobileActivity(iso: string | null): string {
  if (!iso) return 'Not recorded';
  const formatted = new Intl.DateTimeFormat('en-GB', LAST_MOBILE_FORMAT).format(new Date(iso));
  return formatted.replace(', ', ' at ');
}

function allowPersonField(ctx: ToolExecutionContext, field: string): boolean {
  return fieldPermitted({ toolId: 'PERSON_SUMMARY', field, ctx, purpose: 'answer' });
}

/**
 * Audience projection is owned by the central policy.
 * Demo: no privacy redaction of synthetic seeded directory fields.
 * Product authorisation (TL/RM/Executive scope) is applied before this projection.
 */
export function projectPersonSummary(
  person: DirectoryPerson,
  ctx: ToolExecutionContext,
): PersonSummaryProjection {
  const displayName = sanitizeIdentityText(`${person.firstName} ${person.lastName}`.replace(/\s+/g, ' ').trim());
  return {
    displayName: allowPersonField(ctx, 'displayName') ? displayName : 'Advisor',
    reportingRoleLabel: person.reportingRoleLabel,
    teamName: person.teamName,
    regionName: person.regionName,
    accountStatus: person.accountStatus,
    licenceStatus: allowPersonField(ctx, 'licenceStatus') ? person.licenceStatus : null,
    invitationStatus: allowPersonField(ctx, 'invitationStatus') ? person.invitationStatus : null,
    lastMobileActivity: allowPersonField(ctx, 'lastMobileActivity')
      ? formatLastMobileActivity(person.lastMobileActivityAt)
      : null,
    email: allowPersonField(ctx, 'email') ? person.email ?? null : null,
    phone: allowPersonField(ctx, 'phone') ? person.phone ?? null : null,
  };
}

const CLIENT_PII = /contact|client|policy|phone|email|document|note|caseid|case_id/i;

export function containsClientPii(value: string): boolean {
  return CLIENT_PII.test(value);
}

/** End-client identifiers. Advisor directory names are not client PII. */
export function containsEndClientPii(value: string): boolean {
  if (/\b(contactName|clientName|caseId|case_id|policy number|id number|sa id)\b/i.test(value)) return true;
  if (/\b\d{13}\b/.test(value)) return true;
  if (/(?:\+?27|0)[\s-]?[1-9](?:[\s-]?\d){8}\b/.test(value)) return true;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(value)) return true;
  const emails = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return emails.some((email) => email !== '[email]');
}

export function projectPipelineSummary(
  subjectName: string,
  aggregate: PipelineAggregate,
): PipelineSummaryProjection {
  const stageCounts = Object.entries(aggregate.stageCounts)
    .filter(([, count]) => count > 0)
    .map(([stage, count]) => ({ label: getPipelineStageLabel(stage), count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 12);
  return {
    subjectName,
    totalCases: aggregate.totalCases,
    openCases: aggregate.openCases,
    stageCounts,
    pipelineValue: aggregate.pipelineValue,
  };
}
