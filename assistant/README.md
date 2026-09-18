# AdvisorTrack Assistant knowledge — demo backend

The Assistant knowledge corpus is **not** authored here.

Canonical source: production backend `advisor_track_backend` (`Abel Backend`) at `src/assistant`.

This repository consumes a generated snapshot at `src/assistant/knowledge-bundle.json` (Abel `npm run assistant:export-kb`) plus the A6 ask pipeline.

Do not create `src/assistant/kb` or a second card tree. Do not fetch production (`api.advisortrack.co.za`) for help content.

A7.6 live caching, timeouts, circuit breaker, and ask limits run in this demo process only. Demo abuse controls are per-user (30 / 10 minutes), per-IP (80 / 10 minutes), and process-global (250 / 10 minutes). Demo never calls production.
