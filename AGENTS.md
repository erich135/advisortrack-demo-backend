# AdvisorTrack demo backend — agent instructions

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
