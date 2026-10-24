import type { AssistantContext } from '../context';
import { routeReachable } from '../context';
import {
  deriveRegisteredNumbers,
  extraNumbersFromGrounding,
  numbersInText,
} from '../live/derive';
import { workflowInvariants } from '../productMap';
import { containsEndClientPii } from '../live/privacy';
import type { LiveToolFactGroup, RegisteredDerivationOutput } from '../live/types';
import { classificationForRoute } from '../routes';
import type { AssistantRoute } from '../types';
import type { ServerKnowledgeCard } from '../serverBundle';
import type { ConversationTurn } from '../conversationMemory';
import type { AssistantConversationMode } from './prompt';
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
const FORBIDDEN_FINANCIAL_ADVICE =
  /\b(you should (sell|recommend|choose)|i recommend (the )?(policy|product|insurer)|pick this insurer|best product for (the |this )?client|asset allocation)\b/i;
const IMPLEMENTATION_LEAK =
  /\b(kb card|knowledge card|selectedCardIds|xAI|tool id|retriev(al|ed cards)|provider error|prompt error)\b/i;
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
  allowedCards?: ServerKnowledgeCard[];
  candidateIds?: string[];
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
  for (const fact of workflowInvariants(input.context.workspace, input.context.capabilities)) {
    for (const value of numbersInText(fact)) values.add(value);
  }
  const candidateIds = new Set(input.candidateIds ?? []);
  for (const card of input.allowedCards ?? []) {
    if (!candidateIds.has(card.id)) continue;
    for (const value of numbersInText(`${card.summary} ${card.steps.map((step) => step.label).join(' ')}`)) {
      values.add(value);
    }
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
  previousQuestion?: string | null;
  extraToolNumbers?: number[];
  tools?: LiveToolFactGroup[];
  derivations?: RegisteredDerivationOutput[];
  conversationMode?: AssistantConversationMode;
  history?: ConversationTurn[];
}): ModelValidationFailure | null {
  const { decision, context, allowedCards, candidateIds, routes, question } = input;
  const previousQuestion = input.previousQuestion ?? '';
  const chat = input.conversationMode === 'chat';
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
    && !chat
  ) {
    return { code: 'empty_answer', message: 'answer requires selectedCardIds or selectedToolIds' };
  }
  if (chat && decision.outcome === 'answer') {
    if ((decision.selectedCardIds?.length ?? 0) > 0 || (decision.selectedToolIds?.length ?? 0) > 0) {
      return { code: 'chat_grounding', message: 'Conversation answers must not select product cards or tools' };
    }
    if (!decision.body?.trim()) {
      return { code: 'chat_empty', message: 'Conversation answers need a body' };
    }
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
  if (FORBIDDEN_FINANCIAL_ADVICE.test(text)) {
    return { code: 'financial_advice', message: 'Model recommended a financial product or insurer' };
  }
  if (IMPLEMENTATION_LEAK.test(text)) {
    return { code: 'implementation_leak', message: 'Model mentioned internal implementation' };
  }
  if (TELEMETRY_FRAMING.test(text)) {
    return { code: 'telemetry_framing', message: 'Model used Last Mobile Activity as a performance judgement' };
  }
  if (context.environment === 'production' && containsEndClientPii(text)) {
    return { code: 'client_pii', message: 'Model output contained end-client PII' };
  }
  if (/\b(?:GET|POST|PATCH|PUT|DELETE)\s+\//i.test(text) || /\/api\/v1\//i.test(text)) {
    return { code: 'api_leak', message: 'Model mentioned an internal HTTP API' };
  }

  const hasAdvisorProduction =
    context.workspace === 'advisor' && context.capabilities.canViewAdvisorWorkspace === true;
  if (
    hasAdvisorProduction
    && /(?:cannot|can['’]t|do not|don['’]t(?: have)?|no permission|without (?:the )?permission|(?:are not|aren['’]t) visible|can['’]t be shown).{0,100}(?:production|issued)|(?:production|issued).{0,100}(?:cannot|can['’]t|don['’]t have|do not have|no permission|not visible|can['’]t be shown)/i.test(text)
  ) {
    return { code: 'advisor_production_access', message: 'Model denied Advisor Production access' };
  }
  if (
    /\bfica\b/i.test(text)
    && /\b(hard (?:block|400|error)|cannot (?:submit|save|move)|can['’]t (?:submit|save|move)|blocks? (?:submit|save|stage)|must complete.{0,24}fica.{0,24}(?:before )?(?:you can )?submit)\b/i.test(text)
  ) {
    return { code: 'fica_soft_gate', message: 'Model treated incomplete FICA as a hard block' };
  }
  if (
    (/\bsubmit\b/i.test(question) || /\bsubmit\b/i.test(previousQuestion))
    && /\bfica\b/i.test(text)
    && !/\b(commission|greater than 0|greater than zero)\b/i.test(text)
    && !/\b(not the submit|does not submit|isn't the submit|is not the submit|does not block submit)\b/i.test(text)
  ) {
    return { code: 'submit_rule', message: 'Submit troubleshooting must use estimated commission, not FICA as the blocker' };
  }
  if (
    !suppliedTools.has('MY_CASE_SUMMARY')
    && /\b(?:this case|the current case|on this case)\b/i.test(text)
    && /\b(estimated commission is \d|fica is (?:complete|incomplete)|already submitted)\b/i.test(text)
  ) {
    return { code: 'invented_case_state', message: 'Model invented current-case values that were not supplied' };
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

  if (decision.outcome === 'answer' && !chat) {
    const grounded = groundedNumbers({
      question,
      context,
      extraToolNumbers: input.extraToolNumbers,
      tools: input.tools,
      derivations: input.derivations,
      allowedCards,
      candidateIds,
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
