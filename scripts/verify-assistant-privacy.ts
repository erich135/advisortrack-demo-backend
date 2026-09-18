/**
 * AdvisorTrack Assistant A7.4 privacy, projection, provenance, and registry checks.
 * Demo backend consumes the Abel snapshot via loadServerBundle().
 * Run: npm run assistant:privacy-check
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADVISOR_SUMMARY_TOOL,
  askAssistant,
  assertAssistantToolRegistry,
  assertNoClientRows,
  assistantMayGrantSupportElevation,
  buildAssistantContext,
  classPermitted,
  createFakeProvider,
  createFixtureLiveSource,
  createToolExecutionContext,
  loadServerBundle,
  looksLikeCaseRow,
  minimiseLiveToolsForModel,
  PERSON_SUMMARY_TOOL,
  projectionAudience,
  publicFactSource,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
  SUPPORT_ELEVATION_POLICY,
  type TrustedAssistantIdentity,
} from '../src/assistant';
import { DATA_CLASSES, PERSON_SUMMARY_FIELDS, TOOL_FIELD_CATALOG } from '../src/assistant/live/classify';
import { pickPermittedFacts } from '../src/assistant/live/policy';
import { validateAssistantToolRegistry } from '../src/assistant/live/registry';
import { ASSISTANT_TOOLS } from '../src/assistant/live/tools';
import { scrubAssistantAuditMeta } from '../src/assistant/live/log';
import type { FixturePerson } from '../src/assistant/live/source';
import type { AssistantModelDecision } from '../src/assistant/model/types';

resetAssistantAskThrottle();
resetAssistantLiveRuntime();

function identity(
  partial: Partial<TrustedAssistantIdentity> & Pick<TrustedAssistantIdentity, 'userId'>,
): TrustedAssistantIdentity {
  return {
    companyId: 'company-northstar',
    companyName: 'Northstar Advisory',
    reportingRank: 'executive',
    isOrganisationAdmin: false,
    isPlatformStaff: false,
    portalAccess: true,
    hierarchyScopeKind: 'organisation',
    canViewRegions: true,
    canViewTeams: true,
    permissions: [],
    canAccessEngineeringChangelog: false,
    ...partial,
  };
}

const jordan: FixturePerson = {
  id: 'jordan-hale',
  companyId: 'company-northstar',
  firstName: 'Jordan',
  lastName: 'Hale',
  reportingRoleLabel: 'Regional Manager',
  rank: 'regional_manager',
  teamName: null,
  regionName: 'Coastal Region',
  accountStatus: 'Active',
  licenceStatus: 'Licensed',
  invitationStatus: 'Accepted',
  lastMobileActivityAt: '2026-09-17T12:32:00.000Z',
  email: 'jordan.hale@northstar.test',
  phone: '0820000000',
  visibleTo: ['exec-1', 'fa-admin-1', 'staff-1'],
};

const zeros = { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 };
const jordanMonth = {
  issuedAmount: 2_450_000,
  issuedCount: 37,
  nonIssuedAmount: 920_000,
  nonIssuedCount: 18,
};

const source = createFixtureLiveSource({
  people: [jordan],
  pools: { 'company-northstar': { purchased: 40, assigned: 32, available: 8 } },
  production: {
    'jordan-hale': {
      this_week: zeros,
      this_month: jordanMonth,
      last_week: zeros,
      last_month: zeros,
      year_to_date: jordanMonth,
    },
  },
  pipeline: {
    'jordan-hale': {
      totalCases: 12,
      openCases: 6,
      stageCounts: { fact_finding: 3 },
      pipelineValue: 410_000,
      estimatedCommissionCaseCount: 3,
    },
  },
});

const bundle = loadServerBundle();
const boom = createFakeProvider(async () => {
  throw new Error('model should not run');
});

const exec = identity({ userId: 'exec-1' });
const orgAdmin = identity({
  userId: 'fa-admin-1',
  reportingRank: 'financial_advisor',
  portalAccess: false,
  isOrganisationAdmin: true,
  hierarchyScopeKind: null,
  canViewRegions: true,
  canViewTeams: true,
});
const staff = identity({
  userId: 'staff-1',
  reportingRank: 'platform_admin',
  isPlatformStaff: true,
  portalAccess: true,
  canAccessEngineeringChangelog: true,
});

function publicText(result: { answer: { headline: string; body: string; facts?: Array<{ label: string; value: string; source: string }> } }): string {
  return [
    result.answer.headline,
    result.answer.body,
    ...(result.answer.facts ?? []).flatMap((fact) => [fact.label, fact.value, fact.source]),
  ].join('\n');
}

async function main(): Promise<void> {
  assert.deepEqual([...DATA_CLASSES], [
    'operational',
    'identity_directory',
    'account_contact',
    'client_pii',
    'financial_document',
    'telemetry',
    'diagnostic',
  ]);
  assertAssistantToolRegistry();
  assert.equal(validateAssistantToolRegistry().length, 0);
  assert.equal(PERSON_SUMMARY_TOOL.auditClass, 'read_person');
  assert.equal(ADVISOR_SUMMARY_TOOL.auditClass, 'read_person');
  assert.equal(ASSISTANT_TOOLS.every((tool) => tool.auditClass && tool.auditClass !== 'none'), true);

  const missingAudit = validateAssistantToolRegistry([
    { ...PERSON_SUMMARY_TOOL, auditClass: 'none' },
  ]);
  assert.equal(missingAudit.some((issue) => issue.code === 'audit_class_none'), true);

  const demoClientCatalog = validateAssistantToolRegistry(ASSISTANT_TOOLS, {
    ...TOOL_FIELD_CATALOG,
    PERSON_SUMMARY: { ...PERSON_SUMMARY_FIELDS, contactName: 'client_pii' },
  });
  assert.equal(demoClientCatalog.some((issue) => issue.code === 'client_pii_tool'), false);
  assert.equal(demoClientCatalog.some((issue) => issue.code === 'production_client_pii_permitted'), false);
  assert.equal(demoClientCatalog.some((issue) => issue.code === 'demo_synthetic_client_pii_blocked'), false);

  assert.equal(classPermitted({
    dataClass: 'client_pii',
    audience: 'leadership',
    synthetic: false,
    purpose: 'answer',
  }), false);
  assert.equal(classPermitted({
    dataClass: 'client_pii',
    audience: 'leadership',
    synthetic: true,
    purpose: 'answer',
  }), true);
  assert.equal(classPermitted({
    dataClass: 'financial_document',
    audience: 'leadership',
    synthetic: true,
    purpose: 'answer',
  }), true);
  assert.equal(classPermitted({
    dataClass: 'telemetry',
    audience: 'platform_staff',
    synthetic: false,
    purpose: 'answer',
  }), false);
  assert.equal(classPermitted({
    dataClass: 'telemetry',
    audience: 'leadership',
    synthetic: false,
    purpose: 'answer',
  }), true);
  assert.equal(classPermitted({
    dataClass: 'account_contact',
    audience: 'leadership',
    synthetic: true,
    purpose: 'answer',
  }), true);

  const execCtx = createToolExecutionContext({
    identity: exec,
    assistant: buildAssistantContext({
      environment: 'production',
      identity: exec,
      navigation: { pathname: '/' },
    }),
    timeoutMs: 4000,
  });
  const staffCtx = createToolExecutionContext({
    identity: staff,
    assistant: buildAssistantContext({
      environment: 'production',
      identity: staff,
      navigation: { pathname: '/' },
    }),
    timeoutMs: 4000,
  });
  const adminCtx = createToolExecutionContext({
    identity: orgAdmin,
    assistant: buildAssistantContext({
      environment: 'production',
      identity: orgAdmin,
      navigation: { pathname: '/' },
    }),
    timeoutMs: 4000,
  });
  const demoCtx = createToolExecutionContext({
    identity: exec,
    assistant: buildAssistantContext({
      environment: 'demo',
      identity: exec,
      navigation: { pathname: '/' },
    }),
    timeoutMs: 4000,
  });

  assert.equal(projectionAudience(execCtx), 'leadership');
  assert.equal(projectionAudience(staffCtx), 'platform_staff');
  assert.equal(projectionAudience(adminCtx), 'org_admin');
  assert.equal(staffCtx.scope.resolver, 'platform_minimised');
  assert.equal(execCtx.scope.resolver, 'management_reporting');
  assert.equal(adminCtx.scope.resolver, 'administrative');
  assert.equal(staffCtx.dataIsSynthetic, false);
  assert.equal(demoCtx.dataIsSynthetic, true);

  const staffFacts = pickPermittedFacts('PERSON_SUMMARY', {
    displayName: 'Jordan Hale',
    lastMobileActivity: '17 September 2026 at 14:32',
    email: 'jordan.hale@northstar.test',
    issuedAmount: 1,
  }, staffCtx, 'answer');
  assert.equal(staffFacts.displayName, 'Jordan Hale');
  assert.equal(Object.prototype.hasOwnProperty.call(staffFacts, 'lastMobileActivity'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(staffFacts, 'email'), false);

  const demoFacts = pickPermittedFacts('PERSON_SUMMARY', {
    displayName: 'Jordan Hale',
    email: 'jordan.hale@northstar.test',
    lastMobileActivity: '17 September 2026 at 14:32',
    contactName: 'Jane Client',
  }, demoCtx, 'answer');
  assert.equal(demoFacts.email, 'jordan.hale@northstar.test');
  assert.equal(demoFacts.lastMobileActivity, '17 September 2026 at 14:32');
  assert.equal(demoFacts.contactName, 'Jane Client');

  const productionPiiFacts = pickPermittedFacts('PERSON_SUMMARY', {
    displayName: 'Jordan Hale',
    email: 'jordan.hale@northstar.test',
    contactName: 'Jane Client',
  }, execCtx, 'answer');
  assert.equal(Object.prototype.hasOwnProperty.call(productionPiiFacts, 'email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(productionPiiFacts, 'contactName'), false);

  const demoModelFacts = pickPermittedFacts('PERSON_SUMMARY', {
    displayName: 'Jordan Hale',
    contactName: 'Jane Client',
    email: 'jordan.hale@northstar.test',
  }, demoCtx, 'model');
  assert.equal(demoModelFacts.contactName, 'Jane Client');
  assert.equal(demoModelFacts.email, 'jordan.hale@northstar.test');

  assert.equal(looksLikeCaseRow({ contactName: 'Jane Client', caseId: '99' }), true);
  assert.throws(() => assertNoClientRows({ cases: [{ contactName: 'Jane Client', caseId: '99' }] }), /client_row_escaped/);
  assert.doesNotThrow(() => assertNoClientRows(
    { cases: [{ contactName: 'Jane Client', caseId: '99' }] },
    'value',
    { synthetic: true },
  ));
  assert.doesNotThrow(() => assertNoClientRows({
    totalCases: 12,
    openCases: 6,
    stageCounts: { fact_finding: 3 },
  }));

  const staffAssistant = buildAssistantContext({
    environment: 'production',
    identity: staff,
    navigation: { pathname: '/' },
  });
  assert.equal(staffAssistant.role.hasLeadershipPortalAccess, false);
  assert.equal(staffAssistant.capabilities.canViewAdvisors, false);
  assert.equal(staffAssistant.capabilities.canViewProduction, false);
  assert.equal(staffAssistant.capabilities.canViewPipeline, false);
  assert.equal(staffAssistant.capabilities.canViewLicences, true);
  assert.equal(staffAssistant.capabilities.canViewUsers, true);

  const leadershipProd = await askAssistant({
    question: "What is Jordan's production?",
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.equal(leadershipProd.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.match(leadershipProd.answer.body, /2[\s\u00a0]?450[\s\u00a0]?000/);
  assert.doesNotMatch(publicText(leadershipProd), /contactName|Jane Client|caseId/);
  const issuedTrace = leadershipProd.provenance?.factTraces.find((item) => item.field === 'issuedAmount');
  assert.equal(issuedTrace?.toolId, 'PRODUCTION_SUMMARY');
  assert.equal(issuedTrace?.version, 1);
  assert.equal(issuedTrace?.period, 'this_month');
  assert.equal(Boolean(issuedTrace?.entityRef), true);
  assert.equal(leadershipProd.answer.facts?.some((fact) => fact.source === 'Production — This Month So Far'), true);
  assert.doesNotMatch(publicText(leadershipProd), /\bent_[a-f0-9]{8}\b/);
  assert.doesNotMatch(JSON.stringify(leadershipProd.answer), /jordan-hale/);

  const adminLicence = await askAssistant({
    question: 'How many licences are available?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.equal(adminLicence.answer.intent, 'live.LICENCE_SUMMARY');
  const licenceTrace = adminLicence.provenance?.factTraces.find((item) => item.field === 'available');
  assert.equal(licenceTrace?.toolId, 'LICENCE_SUMMARY');
  assert.equal(adminLicence.answer.facts?.some((fact) => fact.source === 'Company licence pool'), true);

  const adminReporting = await askAssistant({
    question: "What is Jordan's production?",
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.notEqual(adminReporting.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.notEqual(adminReporting.answer.intent, 'live.ADVISOR_SUMMARY');

  const faAdminPerson = await askAssistant({
    question: 'Jordan Hale',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.equal(faAdminPerson.answer.intent, 'live.PERSON_SUMMARY');
  assert.doesNotMatch(JSON.stringify(faAdminPerson.answer), /issued production|Team Pipeline/i);

  const staffAdvisor = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: staff,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.notEqual(staffAdvisor.answer.intent, 'live.ADVISOR_SUMMARY');
  assert.notEqual(staffAdvisor.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.doesNotMatch(publicText(staffAdvisor), /Last mobile activity:/);
  assert.doesNotMatch(publicText(staffAdvisor), /@northstar\.test|0820000000|contactName/);

  const staffPerson = await askAssistant({
    question: 'Jordan Hale',
    identity: staff,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.equal(staffPerson.answer.intent, 'live.PERSON_SUMMARY');
  assert.match(staffPerson.answer.body, /Jordan Hale/);
  assert.doesNotMatch(staffPerson.answer.body, /Last mobile activity:/);
  assert.doesNotMatch(staffPerson.answer.body, /jordan\.hale@northstar\.test/);

  const demoPerson = await askAssistant({
    question: 'Jordan Hale',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.match(demoPerson.answer.body, /jordan\.hale@northstar\.test/);

  const demoFa = identity({
    userId: 'fa-1',
    reportingRank: 'financial_advisor',
    portalAccess: false,
    hierarchyScopeKind: null,
    canViewRegions: false,
    canViewTeams: false,
  });
  const demoFaReporting = await askAssistant({
    question: "What is Jordan's production?",
    identity: demoFa,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.notEqual(demoFaReporting.answer.intent, 'live.PRODUCTION_SUMMARY');

  const demoTl = identity({
    userId: 'tl-other',
    reportingRank: 'team_leader',
    portalAccess: true,
    hierarchyScopeKind: 'team',
    canViewRegions: false,
    canViewTeams: true,
  });
  const demoTlLookup = await askAssistant({
    question: 'Jordan Hale',
    identity: demoTl,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.equal(demoTlLookup.answer.intent, 'live.not_found_in_scope');
  const demoTlReporting = await askAssistant({
    question: "What is Jordan's production?",
    identity: demoTl,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boom,
    liveSource: source,
  });
  assert.notEqual(demoTlReporting.answer.intent, 'live.PRODUCTION_SUMMARY');
  assert.notEqual(demoTlReporting.answer.intent, 'live.ADVISOR_SUMMARY');

  const minimised = minimiseLiveToolsForModel('How is Jordan doing this month?', [{
    tool: 'PERSON_SUMMARY',
    version: 1,
    facts: {
      displayName: 'Jordan Hale',
      reportingRoleLabel: 'Regional Manager',
      lastMobileActivity: '17 September 2026 at 14:32',
      invitationStatus: 'Accepted',
      licenceStatus: 'Licensed',
      email: 'hidden',
    },
  }, {
    tool: 'PRODUCTION_SUMMARY',
    version: 1,
    facts: { issuedAmount: 2_450_000, issuedCount: 37, notIssuedAmount: 920_000, notIssuedCount: 18 },
  }], buildAssistantContext({
    environment: 'production',
    identity: exec,
    navigation: { pathname: '/' },
  }));
  const personGroup = minimised.find((tool) => tool.tool === 'PERSON_SUMMARY');
  assert.equal(personGroup?.facts.displayName, 'Jordan Hale');
  assert.equal(Object.prototype.hasOwnProperty.call(personGroup?.facts ?? {}, 'lastMobileActivity'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(personGroup?.facts ?? {}, 'invitationStatus'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(personGroup?.facts ?? {}, 'email'), false);

  const demoMinimised = minimiseLiveToolsForModel('What is Jordan client contact?', [{
    tool: 'PERSON_SUMMARY',
    version: 1,
    facts: {
      displayName: 'Jordan Hale',
      contactName: 'Jane Client',
      email: 'jordan.hale@northstar.test',
      invitationStatus: 'Accepted',
    },
  }], buildAssistantContext({
    environment: 'demo',
    identity: exec,
    navigation: { pathname: '/' },
  }));
  const demoPersonGroup = demoMinimised.find((tool) => tool.tool === 'PERSON_SUMMARY');
  assert.equal(demoPersonGroup?.facts.contactName, 'Jane Client');
  assert.equal(demoPersonGroup?.facts.email, 'jordan.hale@northstar.test');

  let modelPrompt = '';
  const provider = createFakeProvider(async (input) => {
    modelPrompt = input.user;
    const decision: AssistantModelDecision = {
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: ['PRODUCTION_SUMMARY'],
      headline: 'Jordan Hale',
      body: 'Issued production is 2450000.',
    };
    return { rawText: JSON.stringify(decision), decision };
  });
  const composed = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider,
    liveSource: source,
  });
  assert.doesNotMatch(modelPrompt, /lastMobileActivity/);
  assert.doesNotMatch(modelPrompt, /invitationStatus/);
  assert.doesNotMatch(modelPrompt, /contactName|caseId/);
  assert.match(modelPrompt, /issuedAmount/);
  if (composed.origin === 'model') {
    assert.doesNotMatch(composed.answer.body, /Last mobile activity:/);
  }

  const piiProvider = createFakeProvider({
    outcome: 'answer',
    selectedCardIds: [],
    selectedToolIds: ['PRODUCTION_SUMMARY'],
    headline: 'Leak',
    body: 'contactName Jane Client caseId 99',
  });
  const pii = await askAssistant({
    question: 'How is Jordan doing this month?',
    identity: exec,
    navigation: { pathname: '/' },
    environment: 'production',
    bundle,
    provider: piiProvider,
    liveSource: source,
  });
  assert.equal(pii.origin, 'fallback');
  assert.doesNotMatch(pii.answer.body, /Jane Client/);

  assert.equal(assistantMayGrantSupportElevation(), false);
  assert.equal(SUPPORT_ELEVATION_POLICY.assistantMayGrant, false);
  assert.equal(SUPPORT_ELEVATION_POLICY.requires.includes('explicit_request'), true);

  assert.equal(publicFactSource('PRODUCTION_SUMMARY', 'This Month So Far'), 'Production — This Month So Far');
  assert.equal(publicFactSource('LICENCE_SUMMARY'), 'Company licence pool');
  assert.equal(publicFactSource('PERSON_SUMMARY'), 'Advisor profile');

  const liveSource = fs.readFileSync(path.join(process.cwd(), 'src/assistant/live/organisationSource.ts'), 'utf8');
  assert.doesNotMatch(liveSource, /api\.advisortrack/);
  assert.match(liveSource, /advisortrack_demo/);
  const askSource = fs.readFileSync(path.join(process.cwd(), 'src/assistant/ask.ts'), 'utf8');
  assert.doesNotMatch(askSource, /api\.advisortrack/);
  const routes = fs.readFileSync(path.join(process.cwd(), 'src/routes/assistant.routes.ts'), 'utf8');
  assert.doesNotMatch(routes, /provenance/);
  const logSource = fs.readFileSync(path.join(process.cwd(), 'src/assistant/live/log.ts'), 'utf8');
  assert.match(logSource, /prompt\|token\|secret\|password/);
  assert.doesNotMatch(logSource, /question:\s*event/);
  assert.equal(Object.prototype.hasOwnProperty.call(scrubAssistantAuditMeta({ token: 'abc' }, 'demo'), 'token'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(scrubAssistantAuditMeta({ password: 'abc' }, 'production'), 'password'), false);
  assert.equal(scrubAssistantAuditMeta({ detail: 'contactName Jane Client' }, 'demo').detail, 'contactName Jane Client');
  assert.equal(Object.prototype.hasOwnProperty.call(
    scrubAssistantAuditMeta({ detail: 'contactName Jane Client' }, 'production'),
    'detail',
  ), false);
  assert.match(fs.readFileSync(path.join(process.cwd(), 'src/assistant/live/elevation.ts'), 'utf8'), /assistantMayGrant: false/);

  console.log('Assistant privacy checks passed (A7.4 projection, provenance, registry, demo override)');
}

void main();
