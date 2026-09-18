# AdvisorTrack Assistant — demo backend

Canonical cards live in Abel Backend `src/assistant`.

This folder holds:

- the generated snapshot `knowledge-bundle.json` (Abel `npm run assistant:export-kb`)
- the A5/A6 ask pipeline (filter, retrieve, provider boundary, validator)
- the A6.1 conversational layer (`conversation.ts`), including A7.2.1 frustration / correction handling
- the A7.1 live entity foundation (`live/`) against `advisortrack_demo`
- A7.3 grounded model composition over live tool projections (fake-provider testable; deterministic fallback if no provider)

Do not create `src/assistant/kb` or author cards here. Do not fetch `https://api.advisortrack.co.za`.

Demo synthetic seeded data is not privacy-redacted. TL/RM/Executive scope simulation still applies as product authorisation. Privacy and product authorisation are separate: demo may show full seeded directory/contact fields, but a Financial Advisor still cannot receive Executive reporting.

Production projection policy (leadership / org_admin / platform_staff) is implemented in `live/policy.ts` so the demo copy stays aligned with Abel. Runtime demo sets `environment=demo` and `dataIsSynthetic=true`, so **privacy-class redaction is disabled** for synthetic values — including fields classified as `client_pii`. Product authorisation is unchanged: a Team Leader still cannot see another team's data.

Public answers use human source labels (`Production — This Month So Far`, `Company licence pool`, `Advisor profile`). Internal provenance stays off the HTTP `/assistant/ask` payload.

Exceptional support access is a design hook only (`live/elevation.ts`). The Assistant never grants elevation. No Assistant database tables.

Simple A7.1/A7.2 lookups (`Jordan Hale`, licence pool counts, `What is Jordan's production?`) stay deterministic. A7.5 period/entity comparisons, product rankings, and Needs Attention explanations also stay deterministic (`modelCalled === false`). Composition-worthy questions (`How is Jordan doing this month?`, hybrid permission questions, licence planning) may call the model over projected facts only. If no provider is configured, the deterministic live answer is used. Demo never calls production.

## Runtime model provider (A7.7)

Demo may use the same Grok 4.6 adapter:

```text
demo backend → xAI directly
```

never:

```text
demo backend → production AdvisorTrack backend
```

Configure in `.env.demo` (loaded by `npm run dev:demo`):

```text
ASSISTANT_MODEL_PROVIDER=xai
XAI_API_KEY=
ASSISTANT_MODEL_NAME=grok-4.6
ASSISTANT_MODEL_REASONING=medium
ASSISTANT_MODEL_TIMEOUT_MS=8000
ASSISTANT_MODEL_BASE_URL=https://api.x.ai/v1
```

`ASSISTANT_MODEL_PROVIDER=disabled` remains valid. Default endpoint is global; US regional `https://us.api.x.ai/v1` is config-only. Demo synthetic fields are not privacy-minimised. Product scope simulation still applies.

Prompt caching uses `x-grok-conv-id: advisortrack-assistant-decision-v1:<environment>:<opaque-company-key>`. Production and demo never share an affinity id. Live tool facts are untrusted data. Model retries are limited to one repair attempt and never retry 401/403/429. Customer frontend snapshots contain no staff cards.
