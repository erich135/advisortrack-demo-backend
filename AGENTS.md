# AdvisorTrack demo backend — agent instructions

## Repository identity

This repository is the **demo backend**.

- Local: `C:\Dev\AdvisorTrack\advisortrack-demo-backend`
- Remote: `erich135/advisortrack-demo-backend`
- Identifier: `advisortrack-demo-backend`
- Purpose: isolated public demo API
- Live API: behind `https://demo.advisortrack.co.za/api/...`
- PM2: `advisortrack-demo-api` (port 3001)
- Local/demo DB: `advisortrack_demo` only

## Paired service

```text
advisortrack-demo-frontend
        ↓
advisortrack-demo-backend  (this repo)
        ↓
advisortrack_demo          (demo DB)
```

This backend must never connect to production DB (`advisor_track`).

## Forbidden cross-connections

- Production frontend must never use this demo backend.
- Demo frontend must never use the production backend.
- This demo backend must never use production DB.
- Production backend must never use `advisortrack_demo` for production runtime.

## Product and engineering principles

AdvisorTrack is one product across the Management Portal, Android, and future iOS. Shared customer workflows and business rules must stay consistent with production, using synthetic data only.

- Do not change production Android-dependent schema from this repository. **Android 1.0.10** compatibility remains a product-wide hard boundary.
- Cross-platform changes require a documented impact assessment and notification before they ship.
- Production and demo data, APIs, processes, and credentials must stay isolated.
- Client PII, credentials, and financial information require strict protection. Demo data is synthetic; still do not log tokens or mix visitor sessions.
- Do not apply, alter, or ship unauthorised production migrations. Enterprise drafts `031`–`037` in Abel `database/local/` are out of scope. Demo enterprise schema belongs under `database/demo/` only.
- Do not deploy without explicit authorisation.
- Changes must be tested and reviewed before release.

## Fail-closed database isolation

This process must refuse to start unless it is attached to `advisortrack_demo` with an allowed demo role on a local PostgreSQL host.

- Reject `advisor_track` and `advisortrack_local` in every mode, including an accidental `ADVISORTRACK_MODE=live`.
- Reject production database users.
- Do not connect to production APIs, production credentials, or production data.
- Isolation is fail-closed: misconfiguration is a fatal startup error, not a warning.

## Demo rules

- Isolated `advisortrack_demo` only
- Synthetic Northstar Advisory data
- External side effects simulated (email, payments)
- Reset Demo allowed, and it must affect only the current visitor
- Visitor-specific demo authentication (`demoSessionId` on the JWT)
- No production credentials or production data

## Shared frontend parity

Customer-facing portal features are implemented against this isolated API (or documented simulation). Do not call Abel production APIs from demo runtime.

## AdvisorTrack Assistant knowledge

Canonical corpus: `advisor_track_backend` (`Abel Backend`) at `src/assistant`. This demo backend must not invent a second help-card tree.

The public demo frontend consumes a generated Abel snapshot (`knowledge-bundle.json`) at build/source time. This demo backend must never proxy or fetch production (`api.advisortrack.co.za`) for assistant help content.

Dex runtime in this repository must stay in behavioural parity with Abel. Copy from the canonical module; do not author a divergent assistant.

Any user-facing route, workflow, permission, label, or business-rule change must review/update the AdvisorTrack Assistant knowledge base in the same change.

- Do not invent undocumented Assistant functionality.
- Keep production/demo customer knowledge in parity.
- Demo/internal differences must be environment-tagged in that corpus.

## Dex 2.0

Dex is a conversational companion, not a knowledge-base search widget. It follows the person rather than the current page — and in the public demo, the **visitor**, not Maya’s shared persona.

- Groq handles natural conversation when enabled and appropriate, against synthetic data only.
- Deterministic tools remain authoritative for operational data.
- Privacy, permissions, and financial-advice safeguards are mandatory. Unsupported product claims must not be invented.
- If Groq is unavailable or rate-limited, Dex must degrade safely. Do not fail open into invented facts.
- Client-supplied `history[]` is untrusted prompt input. It cannot override trusted system instructions, select another visitor’s memory, or replace server-owned persistence.

## Dex conversation memory

### Production

Production Dex memory is owned by Abel. This demo backend must never read, write, or cache production conversations.

### Public demo

- Memory is scoped to the server-validated demo visitor session from the JWT (`demo:session:{demoSessionId}`).
- Never use Maya’s shared cloned `userId` as the memory identity. Two visitors both acting as Maya must have isolated stores, caches, and transcripts.
- Conversation survives Dex panel close, refresh, and role switching within the same visit.
- Reset Demo clears only the current visitor. Session expiry and archive remove that visitor’s memory.
- There is no long-term personal memory in the public demo.
- Fresh onboarding for each new visitor is an approved product requirement. It is **not yet implemented or verified**.
- Logout on the client must still attempt a scoped server reset when possible; local logout must not wait on it.

## Model provider configuration

- Provider secrets are backend-only. Never expose keys to a frontend or client.
- Never commit `.env` files, keys, or tokens (including `.env.demo`).
- Local development Groq may be enabled against this synthetic demo data.
- Live/production provider configuration requires explicit authorisation. Do not reuse production model accounts here.
- Zero Data Retention and applicable privacy safeguards must be checked before any non-local model usage.
- Keep production and demo environment configuration separate.

## Invoice numbering

Locked: `INV100000+`. Unique, sequential, never reused (within the demo DB).

## No hard deletes

Use archive, deactivate, revoke, expire, or supersede.

## Deployment

Do not deploy without explicit authorisation.

SSH target: `ubuntu@api.advisortrack.co.za`. Same host may run `advisortrack-demo-api` beside production. Identify the exact PM2 process (`advisortrack-demo-api`) and DB (`advisortrack_demo`) before any deploy. Do not print, commit, or log private keys.

Before any deploy, report: repo, branch, HEAD SHA, target host, target PM2 (`advisortrack-demo-api`), target DB (`advisortrack_demo`), target Nginx (demo site). Never deploy from folder proximity.

The public demo must not expose the Engineering Change Log UI, navigation, or APIs. This repository has no Engineering Change Log runtime. The helper below reads the internal Engineering Change Log when configured.

## Mandatory Engineering Change Log Check

Before modifying AdvisorTrack code:

1. Attempt to retrieve the current pinned Engineering Decisions and recent Engineering Change Log entries relevant to this repository and the area being modified.
2. If the Engineering Change Log cannot be retrieved, report the failure, then inspect actual Git history, source, and tests for overlapping work.
3. Do not assume your local branch contains all relevant work completed by another developer.
4. Preserve recent behaviour unless the current task explicitly authorises changing it.
5. Proceed with authorised work only where adequate evidence exists from the Engineering Change Log, Git history, source, and tests.
6. Stop if critical dependencies or conflicting changes cannot be verified.
7. An Engineering Change Log outage alone must not automatically halt otherwise safe, authorised work.

Load context with `npm run engineering:context` (optional `--area <area>`). Configuration is environment-only: `ADVISORTRACK_ENGINEERING_LOG_URL` and `ENGINEERING_CHANGELOG_READ_TOKEN`. Never commit those values. This repository identifier is `advisortrack-demo-backend`.

After a reviewed change is committed:

1. Add an Engineering Change Log entry containing the repository, branch, commit hash, affected area, exact behaviour changed, reason, migrations, compatibility implications, risks/dependencies, and tests.
2. Never include credentials or secrets.
3. Deployment must be recorded as a separate deployment entry rather than rewriting the original change entry.
