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

## Demo rules

- Isolated DB only
- Fake Northstar data
- External side effects simulated (email, payments)
- Reset allowed
- No production credentials or production data

## Shared frontend parity

Customer-facing portal features are implemented against this isolated API (or documented simulation). Do not call Abel production APIs from demo runtime.

## AdvisorTrack Assistant knowledge

Canonical corpus: `advisor_track_backend` (`Abel Backend`) at `src/assistant`. This demo backend must not maintain a second copy of the help cards.

The public demo frontend consumes a generated Abel snapshot (`knowledge-bundle.json`) at build/source time. This demo backend must never proxy or fetch production (`api.advisortrack.co.za`) for assistant help content.

Any user-facing route, workflow, permission, label, or business-rule change must review/update the AdvisorTrack Assistant knowledge base in the same change.

- Do not invent undocumented Assistant functionality.
- Keep production/demo customer knowledge in parity.
- Demo/internal differences must be environment-tagged in that corpus.
- Later assistant API work should consume the canonical module (or an exported bundle), not a handwritten duplicate.

## Invoice numbering

Locked: `INV100000+`. Unique, sequential, never reused (within the demo DB).

## No hard deletes

Use archive, deactivate, revoke, expire, or supersede.

## AdvisorTrack AWS key (operator note only)

Working copy: `C:\Users\erich.ERICHPC\.ssh\advisortrack-main.pem`  
SSH target: `ubuntu@api.advisortrack.co.za`

Same host may run demo PM2 (`advisortrack-demo-api`) beside production. Identify the exact PM2 process and DB before any deploy. Do not print, commit, or log the key.

## Deployment checklist

Before any deploy, report: repo, branch, HEAD SHA, target host, target PM2 (`advisortrack-demo-api`), target DB (`advisortrack_demo`), target Nginx (demo site). Never deploy from folder proximity.

The public demo must not expose the Engineering Change Log UI, navigation, or APIs. This repository has no Engineering Change Log runtime. The helper below reads the internal Engineering Change Log when configured.

## Mandatory Engineering Change Log Check

Before modifying AdvisorTrack code:

1. Read the current pinned Engineering Decisions.
2. Read recent Engineering Change Log entries relevant to this repository and the area being modified.
3. Inspect any referenced commits that overlap the proposed work.
4. Do not assume your local branch contains all relevant work completed by another developer.
5. Preserve recent behaviour unless the current task explicitly authorises changing it.
6. If Engineering Change Log context cannot be retrieved, STOP and report that the mandatory pre-change check could not be completed rather than proceeding blindly.

Load context with `npm run engineering:context` (optional `--area <area>`). Configuration is environment-only: `ADVISORTRACK_ENGINEERING_LOG_URL` and `ENGINEERING_CHANGELOG_READ_TOKEN`. Never commit those values. This repository identifier is `advisortrack-demo-backend`.

After a reviewed change is committed:

1. Add an Engineering Change Log entry containing the repository, branch, commit hash, affected area, exact behaviour changed, reason, migrations, compatibility implications, risks/dependencies, and tests.
2. Never include credentials or secrets.
3. Deployment must be recorded as a separate deployment entry rather than rewriting the original change entry.
