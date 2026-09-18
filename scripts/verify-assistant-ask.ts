/**
 * AdvisorTrack Assistant A6 grounded model layer — demo backend.
 * Consumes Abel-generated knowledge-bundle.json. Never calls production.
 * Run: npm run assistant:ask-check
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  askAssistant,
  createFakeProvider,
  loadServerBundle,
  resetAssistantAskThrottle,
  type TrustedAssistantIdentity,
} from '../src/assistant';
import { asModelResult } from '../src/assistant/model/provider';
import type { AssistantModelDecision } from '../src/assistant/model/types';

resetAssistantAskThrottle();

async function main(): Promise<void> {
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

  const bundle = loadServerBundle();
  const orgAdmin = identity({ userId: 'exec-admin-1', isOrganisationAdmin: true });
  const executive = identity({ userId: 'exec-1' });
  const teamLeader = identity({
    userId: 'tl-1',
    reportingRank: 'team_leader',
    hierarchyScopeKind: 'team',
    canViewRegions: false,
    canViewTeams: true,
  });
  const advisor = identity({
    userId: 'fa-1',
    reportingRank: 'financial_advisor',
    portalAccess: false,
    hierarchyScopeKind: null,
    canViewRegions: false,
    canViewTeams: false,
  });
  const orgAdminFa = identity({
    userId: 'fa-admin-1',
    reportingRank: 'financial_advisor',
    portalAccess: false,
    isOrganisationAdmin: true,
    hierarchyScopeKind: null,
    canViewRegions: true,
    canViewTeams: true,
  });

  const boomProvider = createFakeProvider(async () => {
    throw new Error('model should not run');
  });

  const assign = await askAssistant({
    question: 'How do I assign a licence?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(assign.origin, 'deterministic');
  assert.equal(assign.modelAttempted, false);
  assert.equal(assign.answer.intent, 'LIC.ASSIGN');

  const disabled = await askAssistant({
    question: 'How do I assign a licence?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
  });
  assert.equal(disabled.origin, 'deterministic');
  assert.equal(disabled.answer.intent, 'LIC.ASSIGN');

  let lastPrompt = '';
  const compositeProvider = createFakeProvider(async (input) => {
    lastPrompt = input.user;
    const payload = JSON.parse(input.user) as {
      trustedInstructions?: { candidates?: { id: string }[] };
      candidates?: { id: string }[];
    };
    const candidates = payload.trustedInstructions?.candidates ?? payload.candidates ?? [];
    const preferred = [
      'LIC.POOL_MEANING',
      'LIC.REQUEST_MORE',
      'PEOPLE.BULK_IMPORT_UPLOAD',
      'LIC.ASSIGN',
      'START.WHO_USES_MOBILE',
    ];
    const selectedCardIds = [
      ...preferred.filter((id) => candidates.some((card) => card.id === id)),
      ...candidates.map((card) => card.id),
    ]
      .filter((id, index, list) => list.indexOf(id) === index)
      .slice(0, 5);
    const decision: AssistantModelDecision = {
      outcome: 'answer',
      selectedCardIds,
      intent: 'onboard-advisors',
      extractedSlots: { quantity: 40 },
      headline: 'Licences first, then import',
      body: 'You currently have 12 licences available, so another 28 would be needed for 40 new licensed users. Request the additional licences, prepare Bulk Import, import the advisors, assign licences, then advisors activate on Android.',
    };
    return asModelResult(decision);
  });

  const composite = await askAssistant({
    question: 'We hired 40 advisers and only have 12 licences available. What do I do?',
    identity: orgAdmin,
    navigation: { pathname: '/licences' },
    environment: 'demo',
    bundle,
    licencePool: { purchased: 20, assigned: 8, available: 12 },
    provider: compositeProvider,
  });
  assert.equal(composite.origin, 'model');
  assert.ok(composite.answer.sources.length >= 2);
  assert.match(composite.answer.body, /12/);
  assert.match(composite.answer.body, /28/);
  assert.equal(
    composite.answer.sources.some((source) => source.cardId === 'STAFF.LICENCE_REQUEST_QUEUE'),
    false,
  );
  assert.doesNotMatch(lastPrompt, /STAFF\.LICENCE_REQUEST_QUEUE/);
  assert.match(lastPrompt, /"environment":"demo"/);

  let teamLeaderPrompt = 'none';
  const recordProvider = createFakeProvider(async (input) => {
    teamLeaderPrompt = input.user;
    return asModelResult({ outcome: 'insufficient_context', selectedCardIds: [] });
  });
  const tlInvoices = await askAssistant({
    question: 'Where do I find invoices?',
    identity: teamLeader,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: recordProvider,
  });
  assert.notEqual(tlInvoices.answer.intent, 'COMM.INVOICES');
  assert.doesNotMatch(teamLeaderPrompt, /COMM\.INVOICES/);

  const faHire = await askAssistant({
    question: 'I hired 50 new advisors',
    identity: advisor,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: recordProvider,
  });
  assert.notEqual(faHire.answer.intent, 'LIC.REQUEST_MORE');
  assert.equal(faHire.answer.sources.some((source) => source.cardId.startsWith('STAFF.')), false);

  const faAdminInvoices = await askAssistant({
    question: 'Where do I find invoices?',
    identity: orgAdminFa,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(faAdminInvoices.answer.intent, 'COMM.INVOICES');

  const faAdminPipeline = await askAssistant({
    question: 'Where is Team Pipeline?',
    identity: orgAdminFa,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: recordProvider,
  });
  assert.notEqual(faAdminPipeline.answer.intent, 'REPORT.TEAM_PIPELINE');

  const customerStaff = await askAssistant({
    question: 'Where is the Engineering Change Log?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: recordProvider,
  });
  assert.notEqual(customerStaff.answer.intent, 'STAFF.ENGINEERING_CHANGE_LOG');

  const forgedCard = await askAssistant({
    question: 'We hired 40 advisers and only have 12 licences available. What do I do?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    licencePool: { purchased: 20, assigned: 8, available: 12 },
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: ['STAFF.ENTERPRISE_CUSTOMERS'],
      headline: 'Internal onboarding',
      body: 'Open Enterprise Customers.',
    }),
  });
  assert.equal(forgedCard.origin, 'fallback');
  assert.equal(
    forgedCard.answer.sources.some((source) => source.cardId === 'STAFF.ENTERPRISE_CUSTOMERS'),
    false,
  );

  const forgedRoute = await askAssistant({
    question: 'We hired 40 advisers and only have 12 licences available. What do I do?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    licencePool: { purchased: 20, assigned: 8, available: 12 },
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: ['LIC.ASSIGN'],
      headline: 'Secret admin',
      body: 'Open /super-admin to finish this.',
    }),
  });
  assert.equal(forgedRoute.origin, 'fallback');
  assert.doesNotMatch(forgedRoute.answer.body, /super-admin/);

  const inventedSum = await askAssistant({
    question: 'Issued production is 2000000 and not yet issued is 500000. How is Jordan doing?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    licencePool: { purchased: 20, assigned: 8, available: 12 },
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: ['LIC.ASSIGN'],
      headline: 'Totals',
      body: 'Together that is 2500000.',
    }),
  });
  assert.equal(inventedSum.origin, 'fallback');
  assert.doesNotMatch(inventedSum.answer.body, /2500000/);

  const invented = await askAssistant({
    question: 'We hired 40 advisers and only have 12 licences available. What do I do?',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    licencePool: { purchased: 20, assigned: 8, available: 12 },
    provider: createFakeProvider({
      outcome: 'answer',
      selectedCardIds: ['LIC.ASSIGN'],
      headline: 'Licence plan',
      body: 'You have 75 available licences so you are fine.',
    }),
  });
  assert.equal(invented.origin, 'fallback');
  assert.doesNotMatch(invented.answer.body, /75 available/);

  const unknown = await askAssistant({
    question: 'how do quantum bananas invoice the moon',
    identity: orgAdmin,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(unknown.origin, 'deterministic');
  assert.equal(unknown.answer.mode, 'unknown');

  const demoReset = await askAssistant({
    question: 'How do I reset the demo?',
    identity: executive,
    navigation: { pathname: '/' },
    environment: 'demo',
    bundle,
    provider: boomProvider,
  });
  assert.equal(demoReset.answer.intent, 'DEMO.RESET');

  const root = path.join(process.cwd());
  const assistantDir = fs.readdirSync(path.join(root, 'src/assistant'));
  assert.equal(assistantDir.includes('kb'), false);
  const service = fs.readFileSync(path.join(root, 'src/assistant/service.ts'), 'utf8');
  assert.match(service, /environment: 'demo'/);
  assert.doesNotMatch(service, /https:\/\/api\.advisortrack/);
  const askFile = fs.readFileSync(path.join(root, 'src/assistant/ask.ts'), 'utf8');
  assert.doesNotMatch(askFile, /https:\/\/api\.advisortrack/);
  const routes = fs.readFileSync(path.join(root, 'src/routes/assistant.routes.ts'), 'utf8');
  assert.match(routes, /\/ask/);
  assert.doesNotMatch(routes, /https:\/\/api\.advisortrack/);
  assert.doesNotMatch(routes, /companyId/);
  assert.ok(fs.existsSync(path.join(root, 'src/assistant/knowledge-bundle.json')));

  console.log('Demo Assistant ask checks passed (A6 snapshot pipeline, no production proxy)');
}

void main();
