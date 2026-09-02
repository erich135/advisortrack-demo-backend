/**
 * Read-only Engineering Change Log context for coding agents.
 * Reads the internal AdvisorTrack Engineering Change Log; this demo repo has no ECL API.
 *   npm run engineering:context -- --area pipeline
 */
import dotenv from 'dotenv';

dotenv.config();

const REPOSITORY = 'advisortrack-demo-backend';

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
};

async function main(): Promise<void> {
  const base =
    process.env.ADVISORTRACK_ENGINEERING_LOG_URL?.trim() ||
    'http://127.0.0.1:3000/api/v1/platform/engineering/agent-context';
  const token = process.env.ENGINEERING_CHANGELOG_READ_TOKEN?.trim();
  if (!token) {
    console.error('Engineering Change Log unavailable — required pre-change context could not be loaded.');
    console.error('Set ENGINEERING_CHANGELOG_READ_TOKEN (and optionally ADVISORTRACK_ENGINEERING_LOG_URL).');
    process.exit(1);
  }

  const url = new URL(base);
  url.searchParams.set('repository', flag('--repository') || REPOSITORY);
  const area = flag('--area');
  if (area) url.searchParams.set('area', area);
  const limit = flag('--limit');
  if (limit) url.searchParams.set('limit', limit);

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Engineering-Read-Token': token,
    },
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    console.error('Engineering Change Log unavailable — required pre-change context could not be loaded.');
    console.error(`HTTP ${response.status}`);
    process.exit(1);
  }
  console.log(JSON.stringify(body?.data ?? body, null, 2));
}

main().catch((error) => {
  console.error('Engineering Change Log unavailable — required pre-change context could not be loaded.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
