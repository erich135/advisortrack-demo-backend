import type { AssistantContext } from '../context';
import { routeReachable } from '../context';
import {
  deriveRegisteredNumbers,
  extraNumbersFromGrounding,
  numbersInText,
} from '../live/derive';
import { containsEndClientPii } from '../live/privacy';
import type { LiveToolFactGroup, RegisteredDerivationOutput } from '../live/types';
import { classificationForRoute } from '../routes';
import type { AssistantRoute } from '../types';
import type { ServerKnowledgeCard } from '../serverBundle';
import type { AssistantModelDecision } from './types';

export type ModelValidationFailure = {
  code: string;
  message: string;
};

const FORBIDDEN_WRITE = /\b(delete permanently|hard-delete|void the invoice|send the invoice|charge vat|create an invoice)\b/i;
const FA_CANNOT_PORTAL =
  /financial advisors? (cannot|can't|do not|don't|never) (use|access|sign into|log into) (the )?(portal|dashboard|management portal)/i;
const PATH_LIKE = /\/[a-z0-9-]{2,}/gi;
const HTML_MARKUP = /<\s*[a-z][\s\S]*>/i;
const FORBIDDEN_PERFORMANCE =
  /\b(weak|bad performer|lazy|underperforming|under-performer|excellent|struggling|poor performer|poor performance|poor engagement|low effort)\b/i;
const TELEMETRY_FRAMING =
  /(last mobile activity|low activity|telemetry)[\s\S]{0,90}(means|shows|indicates|implies|because)[\s\S]{0,50}(lazy|poor|weak|underperform|inactive|not working|low effort|engagement|performance)|\b(lazy|poor performance|low effort|inactive advisor|not working|poor engagement)\b[\s\S]{0,90}(last mobile activity|telemetry|low activity)/i;
const ENTITY_REF = /\bent_[a-f0-9]{8}\b/gi;
const UNTRUSTED_URL = /\b(?:https?:\/\/|mailto:)/i;
const UNTRUSTED_URL_TOKEN = /(?:https?:\/\/[^\s)\]>'"]+|mailto:[^\s)\]>'"]+)/gi;

function groundedNumbers(input: {
  question: string;
  context: AssistantContext;
  extraToolNumbers?: number[];
  tools?: LiveToolFactGroup[];
  derivations?: RegisteredDerivationOutput[];
}): Set<number> {
  const values = new Set<number>();
  const pool = input.context.facts?.licencePool;
  if (pool) {
    if (pool.purchased != null) values.add(pool.purchased);
    values.add(pool.assigned);
    if (pool.available != null) values.add(pool.available);
  }
  for (const value of extraNumbersFromGrounding({
    tools: input.tools,
    derivations: input.derivations,
  })) {
    values.add(value);
  }
  for (const value of deriveRegisteredNumbers({
    question: input.question,
    pool,
    extraToolNumbers: input.extraToolNumbers,
  })) {
    values.add(value);
  }
  return values;
}

export function validateModelDecision(input: {
  decision: AssistantModelDecision;
  context: AssistantContext;
  allowedCards: ServerKnowledgeCard[];
  candidateIds: string[];
  routes: AssistantRoute[];
  question: string;
  extraToolNumbers?: number[];
  tools?: LiveToolFactGroup[];
  derivations?: RegisteredDerivationOutput[];
}): ModelValidationFailure | null {
  const { decision, context, allowedCards, candidateIds, routes, question } = input;
  const allowedById = new Map(allowedCards.map((card) => [card.id, card]));
  const suppliedTools = new Map((input.tools ?? []).map((tool) => [tool.tool, tool]));
  const suppliedDerivations = new Set((input.derivations ?? []).map((item) => item.derivationId));
  const allowedRefs = new Set(
    (input.tools ?? []).map((tool) => tool.entity).filter((value): value is string => Boolean(value)),
  );

  for (const id of decision.selectedCardIds) {
    if (!candidateIds.includes(id)) {
      return { code: 'forged_card', message: `Card ${id} was not supplied as a candidate` };
    }
    const card = allowedById.get(id);
    if (!card) {
      return { code: 'forged_card', message: `Card ${id} is not allowed for this caller` };
    }
    if (contextAudienceIsCustomer(context) && card.audience === 'staff') {
      return { code: 'staff_leak', message: 'Staff card selected for a customer session' };
    }
    if (card.environment !== 'both' && card.environment !== context.environment) {
      return { code: 'environment', message: `Card ${id} is not available in ${context.environment}` };
    }
  }

  for (const toolId of decision.selectedToolIds ?? []) {
    if (!suppliedTools.has(toolId)) {
      return { code: 'forged_tool', message: `Tool ${toolId} was not supplied` };
    }
  }

  for (const derivationId of decision.selectedDerivationIds ?? []) {
    if (!suppliedDerivations.has(derivationId)) {
      return { code: 'forged_tool', message: `Derivation ${derivationId} was not supplied` };
    }
  }

  if (
    decision.outcome === 'answer'
    && decision.selectedCardIds.length === 0
    && !(decision.selectedToolIds ?? []).length
  ) {
    return { code: 'empty_answer', message: 'answer requires selectedCardIds or selectedToolIds' };
  }
  if (decision.outcome === 'clarify' && !decision.clarifyingQuestion?.trim()) {
    return { code: 'clarify', message: 'clarify requires clarifyingQuestion' };
  }

  const selected = decision.selectedCardIds
    .map((id) => allowedById.get(id))
    .filter((card): card is ServerKnowledgeCard => Boolean(card));

  const text = `${decision.headline ?? ''} ${decision.body ?? ''} ${decision.clarifyingQuestion ?? ''} ${(decision.steps ?? []).map((step) => step.label).join(' ')}`;
  if (HTML_MARKUP.test(text)) {
    return { code: 'markup', message: 'Model used HTML/markdown as authoritative output' };
  }
  if (UNTRUSTED_URL.test(text)) {
    const allowedLinks = new Set<string>();
    for (const card of allowedCards) {
      const blob = `${card.summary} ${card.steps.map((step) => step.label).join(' ')}`;
      for (const match of blob.matchAll(UNTRUSTED_URL_TOKEN)) {
        allowedLinks.add(match[0]);
      }
    }
    for (const route of routes) {
      const blob = `${route.path} ${route.label} ${route.demoLabel ?? ''}`;
      for (const match of blob.matchAll(UNTRUSTED_URL_TOKEN)) {
        allowedLinks.add(match[0]);
      }
    }
    const claimed = text.match(UNTRUSTED_URL_TOKEN) ?? [];
    if (claimed.some((link) => !allowedLinks.has(link))) {
      return { code: 'untrusted_url', message: 'Model emitted an untrusted URL or mailto link' };
    }
  }
  if (FORBIDDEN_WRITE.test(text)) {
    return { code: 'write_action', message: 'Model recommended a write beyond v1 navigation' };
  }
  if (context.role.isOrganisationAdmin && FA_CANNOT_PORTAL.test(text)) {
    return { code: 'fa_org_admin', message: 'Model erased Organisation Admin portal access' };
  }
  if (!context.capabilities.canViewPipeline && /\bopen team pipeline\b/i.test(text)) {
    return { code: 'capability', message: 'Model recommended Team Pipeline without capability' };
  }
  if (!context.capabilities.canViewInvoices && /\bopen invoices\b/i.test(text) && !selected.some((card) => card.id.startsWith('COMM.'))) {
    return { code: 'capability', message: 'Model recommended Invoices without capability' };
  }
  if (FORBIDDEN_PERFORMANCE.test(text)) {
    return { code: 'performance_language', message: 'Model used unsupported performance judgement' };
  }
  if (TELEMETRY_FRAMING.test(text)) {
    return { code: 'telemetry_framing', message: 'Model used Last Mobile Activity as a performance judgement' };
  }
  if (context.environment === 'production' && containsEndClientPii(text)) {
    return { code: 'client_pii', message: 'Model output contained end-client PII' };
  }

  const subjectAccess = (input.derivations ?? []).find((item) => item.derivationId === 'SUBJECT_LEADERSHIP_ACCESS');
  if (
    subjectAccess
    && subjectAccess.facts.hasLeadershipPortalAccess === false
    && /\b(can|does|will) (see|access|open|use) production\b/i.test(text)
    && !/\bcannot\b|\bcan'?t\b|\bdoes not\b|\bdoesn't\b/i.test(text)
  ) {
    return { code: 'capability', message: 'Model claimed Production access not supported by stored rank' };
  }

  const pathMatches = text.match(PATH_LIKE) ?? [];
  for (const path of pathMatches) {
    if (path.startsWith('//')) continue;
    const route = routes.find((item) => item.path.split('?')[0] === path);
    if (!route) {
      return { code: 'forged_route', message: `Unknown path ${path}` };
    }
    if (!routeReachable(route, context)) {
      return { code: 'forbidden_route', message: `Path ${path} is not reachable` };
    }
    if (contextAudienceIsCustomer(context) && classificationForRoute(route, context.environment) !== 'customer') {
      return { code: 'staff_leak', message: `Path ${path} is not a customer route` };
    }
  }

  for (const step of decision.steps ?? []) {
    if (!step.routeId) continue;
    const route = routes.find((item) => item.routeId === step.routeId);
    if (!route || !routeReachable(route, context)) {
      return { code: 'forbidden_route', message: `Step route ${step.routeId} is not reachable` };
    }
    const allowedByCard = selected.some((card) => card.routes.includes(step.routeId!));
    if (!allowedByCard) {
      return { code: 'forged_route', message: `Step route ${step.routeId} was not on a selected card` };
    }
  }

  const claimedRefs = text.match(ENTITY_REF) ?? [];
  for (const ref of claimedRefs) {
    if (!allowedRefs.has(ref)) {
      return { code: 'forged_entity_ref', message: `Entity ref ${ref} was not supplied` };
    }
  }

  if (decision.outcome === 'answer') {
    const grounded = groundedNumbers({
      question,
      context,
      extraToolNumbers: input.extraToolNumbers,
      tools: input.tools,
      derivations: input.derivations,
    });
    const claimed = [
      ...numbersInText(decision.headline ?? ''),
      ...numbersInText(decision.body ?? ''),
      ...(decision.steps ?? []).flatMap((step) => numbersInText(step.label)),
    ];
    for (const value of claimed) {
      if (!grounded.has(value)) {
        return { code: 'ungrounded_number', message: 'Use only numbers explicitly present in the supplied trusted facts/derivations.' };
      }
    }
  }

  return null;
}

function contextAudienceIsCustomer(context: AssistantContext): boolean {
  return !context.role.isPlatformStaff;
}
