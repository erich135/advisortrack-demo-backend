/**
 * AdvisorTrack Assistant A7.7 xAI Grok 4.6 adapter — demo backend.
 * Consumes Abel-generated knowledge-bundle.json. Never calls production.
 * Run: npm run assistant:xai-check
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  askAssistant,
  ASSISTANT_XAI_CACHE_KEY,
  createAssistantProviderFromConfig,
  createFixtureLiveSource,
  createXaiProvider,
  DEFAULT_XAI_BASE_URL,
  DEFAULT_XAI_MODEL,
  loadServerBundle,
  resetAssistantAskThrottle,
  resetAssistantLiveRuntime,
  xaiAffinityId,
  type TrustedAssistantIdentity,
} from '../src/assistant';
import { AssistantProviderError } from '../src/assistant/model/provider';
import {
  assistantModelDecisionJsonSchema,
  parseXaiUsage,
  xaiChatCompletionsUrl,
} from '../src/assistant/model/xaiProvider';
import type { AssistantModelDecision } from '../src/assistant/model/types';
import type { FixturePerson } from '../src/assistant/live/source';

resetAssistantAskThrottle();
resetAssistantLiveRuntime();

const SECRET = 'xai-test-secret-key-do-not-leak';
const LEAK_BODY = 'xAI stack trace with sk-internal-secret';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function completionPayload(decision: AssistantModelDecision, usage?: Record<string, unknown>) {
  return {
    id: 'chatcmpl-test',
    model: DEFAULT_XAI_MODEL,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: JSON.stringify(decision) },
      finish_reason: 'stop',
    }],
    usage: usage ?? {
      prompt_tokens: 1200,
      completion_tokens: 180,
      total_tokens: 1380,
      prompt_tokens_details: { cached_tokens: 900 },
      completion_tokens_details: { reasoning_tokens: 70 },
      cost: 0.0042,
    },
  };
}

const groundedDecision: AssistantModelDecision = {
  outcome: 'answer',
  selectedCardIds: [],
  selectedToolIds: ['PERSON_SUMMARY', 'PRODUCTION_SUMMARY'],
  headline: 'Jordan this month',
  body: 'Jordan Hale has issued production of 2450000 this month so far.',
};

async function main(): Promise<void> {
  assert.equal(DEFAULT_XAI_BASE_URL, 'https://api.x.ai/v1');
  assert.equal(DEFAULT_XAI_MODEL, 'grok-4.6');
  assert.equal(xaiChatCompletionsUrl('https://api.x.ai/v1/'), 'https://api.x.ai/v1/chat/completions');
  assert.equal(xaiChatCompletionsUrl('https://us.api.x.ai/v1'), 'https://us.api.x.ai/v1/chat/completions');
  assert.equal(ASSISTANT_XAI_CACHE_KEY, 'advisortrack-assistant-decision-v1');
  assert.doesNotMatch(ASSISTANT_XAI_CACHE_KEY, /user|company|northstar|jordan/i);
  assert.equal(assistantModelDecisionJsonSchema.required.includes('outcome'), true);
  assert.equal(assistantModelDecisionJsonSchema.additionalProperties, false);

  const disabled = createAssistantProviderFromConfig({
    provider: 'disabled',
    timeoutMs: 8000,
  });
  assert.equal(disabled.id, 'disabled');
  await assert.rejects(() => disabled.complete({
    system: 'sys',
    user: 'user',
    schemaName: 'AssistantModelDecision',
    timeoutMs: 8000,
  }), (error: unknown) => error instanceof AssistantProviderError && error.code === 'disabled');

  const missingKey = createAssistantProviderFromConfig({
    provider: 'xai',
    xaiApiKey: '',
    timeoutMs: 8000,
  });
  assert.equal(missingKey.id, 'disabled');

  let captured: { url: string; headers: Headers; body: Record<string, unknown> } | undefined;
  const okProvider = createXaiProvider({
    apiKey: SECRET,
    timeoutMs: 8000,
    reasoning: 'medium',
    fetchImpl: async (input, init) => {
      captured = {
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      };
      return jsonResponse(200, completionPayload(groundedDecision));
    },
  });
  const ok = await okProvider.complete({
    system: 'You are the AdvisorTrack Assistant grounded composer.',
    user: JSON.stringify({ question: 'How is Jordan doing this month?' }),
    schemaName: 'AssistantModelDecision',
    timeoutMs: 8000,
  });
  assert.equal(ok.decision.headline, 'Jordan this month');
  assert.equal(ok.usage?.modelName, 'grok-4.6');
  assert.equal(ok.usage?.inputUsage, 1200);
  assert.equal(ok.usage?.cachedInputUsage, 900);
  assert.equal(ok.usage?.outputUsage, 180);
  assert.equal(ok.usage?.reasoningUsage, 70);
  assert.equal(ok.usage?.requestCostUsd, 0.0042);
  assert.ok((ok.usage?.latencyMs ?? -1) >= 0);
  assert.equal(captured?.url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(captured?.headers.get('authorization'), `Bearer ${SECRET}`);
  assert.equal(captured?.headers.get('x-grok-conv-id'), xaiAffinityId({ environment: 'unknown', companyId: null }));
  assert.equal(captured?.body.model, 'grok-4.6');
  assert.equal(captured?.body.reasoning_effort, 'medium');
  assert.equal(captured?.body.max_tokens, 1536);
  const format = captured?.body.response_format as { type?: string; json_schema?: { name?: string; strict?: boolean } };
  assert.equal(format?.type, 'json_schema');
  assert.equal(format?.json_schema?.name, 'AssistantModelDecision');
  assert.equal(format?.json_schema?.strict, true);
  assert.doesNotMatch(JSON.stringify(captured?.headers), /company-|user-/);

  const usage = parseXaiUsage({
    usage: {
      prompt_tokens: 10,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 6 },
      completion_tokens_details: { reasoning_tokens: 2 },
      cost: '0.01',
    },
  }, { modelName: 'grok-4.6', latencyMs: 12, providerHttpStatus: 200 });
  assert.equal(usage.cachedInputUsage, 6);
  assert.equal(usage.requestCostUsd, 0.01);

  async function expectCode(
    status: number,
    code: AssistantProviderError['code'],
    body: unknown = { error: { message: LEAK_BODY } },
  ) {
    const provider = createXaiProvider({
      apiKey: SECRET,
      timeoutMs: 8000,
      fetchImpl: async () => jsonResponse(status, body),
    });
    await assert.rejects(
      () => provider.complete({
        system: 'sys',
        user: 'user',
        schemaName: 'AssistantModelDecision',
        timeoutMs: 8000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AssistantProviderError);
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, new RegExp(SECRET));
        assert.doesNotMatch(error.message, /sk-internal-secret|stack trace/i);
        return true;
      },
    );
  }

  await expectCode(401, 'http');
  await expectCode(429, 'rate_limit');
  await expectCode(500, 'unavailable');

  const malformed = createXaiProvider({
    apiKey: SECRET,
    timeoutMs: 8000,
    fetchImpl: async () => jsonResponse(200, {
      choices: [{ message: { content: 'not json at all' } }],
    }),
  });
  await assert.rejects(
    () => malformed.complete({
      system: 'sys',
      user: 'user',
      schemaName: 'AssistantModelDecision',
      timeoutMs: 8000,
    }),
    (error: unknown) => error instanceof AssistantProviderError && error.code === 'malformed',
  );

  const invalid = createXaiProvider({
    apiKey: SECRET,
    timeoutMs: 8000,
    fetchImpl: async () => jsonResponse(200, {
      choices: [{ message: { content: JSON.stringify({ outcome: 'nope', selectedCardIds: [] }) } }],
    }),
  });
  await assert.rejects(
    () => invalid.complete({
      system: 'sys',
      user: 'user',
      schemaName: 'AssistantModelDecision',
      timeoutMs: 8000,
    }),
    (error: unknown) => error instanceof AssistantProviderError && error.code === 'schema',
  );

  const hanging = createXaiProvider({
    apiKey: SECRET,
    timeoutMs: 40,
    fetchImpl: async (_input, init) => new Promise((_, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal) {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }
    }),
  });
  await assert.rejects(
    () => hanging.complete({
      system: 'sys',
      user: 'user',
      schemaName: 'AssistantModelDecision',
      timeoutMs: 40,
    }),
    (error: unknown) => error instanceof AssistantProviderError && error.code === 'timeout',
  );

  const bundle = loadServerBundle();
  const exec: TrustedAssistantIdentity = {
    userId: 'exec-1',
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
  };
  const jordan: FixturePerson = {
    id: 'jordan-hale',
    companyId: 'company-northstar',
    firstName: 'Jordan',
    lastName: 'Hale',
    reportingRoleLabel: 'Regional Manager',
    rank: 'regional_manager',
    licenceStatus: 'Licensed',
    invitationStatus: 'Accepted',
    lastMobileActivityAt: '2026-09-17T12:32:00.000Z',
    email: 'jordan@northstar.test',
    phone: '0820000000',
    accountStatus: 'Active',
    teamId: null,
    teamName: null,
    regionId: 'coastal',
    regionName: 'Coastal Region',
    visibleTo: ['exec-1'],
  };
  const month = { issuedAmount: 2_450_000, issuedCount: 37, nonIssuedAmount: 920_000, nonIssuedCount: 18 };
  const zeros = { issuedAmount: 0, issuedCount: 0, nonIssuedAmount: 0, nonIssuedCount: 0 };
  const source = createFixtureLiveSource({
    people: [jordan],
    pools: { 'company-northstar': { purchased: 20, assigned: 8, available: 12 } },
    production: {
      'jordan-hale': {
        this_week: month,
        this_month: month,
        last_week: zeros,
        last_month: zeros,
        year_to_date: month,
      },
    },
  });

  const ask = (question: string, provider: ReturnType<typeof createXaiProvider>) =>
    askAssistant({
      question,
      identity: exec,
      navigation: { pathname: '/' },
      environment: 'production',
      bundle,
      provider,
      liveSource: source,
    });

  const composed = await ask('How is Jordan doing this month?', okProvider);
  assert.equal(composed.origin, 'model');
  assert.match(composed.answer.body, /2[\s\u00a0]?450[\s\u00a0]?000|2450000/);
  assert.equal(composed.provenance?.modelName, 'grok-4.6');
  assert.equal(composed.provenance?.inputUsage, 1200);
  assert.equal(composed.provenance?.cachedInputUsage, 900);

  const inventedProvider = createXaiProvider({
    apiKey: SECRET,
    timeoutMs: 8000,
    fetchImpl: async () => jsonResponse(200, completionPayload({
      outcome: 'answer',
      selectedCardIds: [],
      selectedToolIds: ['PRODUCTION_SUMMARY'],
      headline: 'Invented',
      body: 'Issued production is 2450000 and the secret total is 3370000.',
    })),
  });
  const invented = await ask('How is Jordan doing this month?', inventedProvider);
  assert.equal(invented.origin, 'fallback');
  assert.doesNotMatch(invented.answer.body, /3370000/);
  assert.doesNotMatch(JSON.stringify(invented.answer), /3370000/);

  const leakProvider = createXaiProvider({
    apiKey: SECRET,
    timeoutMs: 8000,
    fetchImpl: async () => jsonResponse(500, { error: { message: LEAK_BODY } }),
  });
  const leaked = await ask('How is Jordan doing this month?', leakProvider);
  assert.notEqual(leaked.origin, 'model');
  assert.doesNotMatch(leaked.answer.body, /sk-internal-secret|stack trace|xAI/i);
  assert.doesNotMatch(leaked.answer.headline, /sk-internal-secret/);

  const timeoutProvider = createXaiProvider({
    apiKey: SECRET,
    timeoutMs: 30,
    fetchImpl: async (_input, init) => new Promise((_, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal) {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }
    }),
  });
  const timedOut = await ask('How is Jordan doing this month?', timeoutProvider);
  assert.notEqual(timedOut.origin, 'model');
  assert.doesNotMatch(timedOut.answer.body, /timed out|AbortError/i);

  const adapterSource = fs.readFileSync(path.join(process.cwd(), 'src/assistant/model/xaiProvider.ts'), 'utf8');
  assert.match(adapterSource, /chat\/completions/);
  assert.match(adapterSource, /reasoning_effort/);
  assert.match(adapterSource, /json_schema/);
  assert.doesNotMatch(adapterSource, /api\.advisortrack/);
  const askSource = fs.readFileSync(path.join(process.cwd(), 'src/assistant/ask.ts'), 'utf8');
  assert.doesNotMatch(askSource, /api\.x\.ai/);
  const liveTools = fs.readFileSync(path.join(process.cwd(), 'src/assistant/live/tools.ts'), 'utf8');
  assert.doesNotMatch(liveTools, /createXaiProvider|api\.x\.ai/);
  const validateSource = fs.readFileSync(path.join(process.cwd(), 'src/assistant/model/validate.ts'), 'utf8');
  assert.doesNotMatch(validateSource, /api\.x\.ai|createXaiProvider/);

  console.log('Assistant xAI adapter checks passed (A7.7 Grok 4.6 structured provider)');
}

void main();
