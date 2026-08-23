/**
 * Phase 10 demo HTTP/side-effect child. Spawned by verify-phase10.ts.
 * Uses ADVISORTRACK_ENV_FILE=.env.demo. Does not print secrets.
 */
const demoEnvPath = process.env.ADVISORTRACK_ENV_FILE;
if (!demoEnvPath) {
  console.error('ADVISORTRACK_ENV_FILE is required');
  process.exit(1);
}
process.env.ADVISORTRACK_MODE = 'demo';
const port = 3012;

const main = async () => {
  const { createApp } = await import('../src/app');
  const { sendMail } = await import('../src/services/emailService');
  const { demoSessionService } = await import('../src/services/demoSession.service');
  const { checkDatabaseConnection, closeDatabase } = await import('../src/config/database');
  const db = await checkDatabaseConnection();
  if (!db.connected) throw new Error(db.message);
  const mail = await sendMail({
    to: 'nobody@example.test',
    subject: 'should not send',
    text: 'no',
    html: '<p>no</p>',
    category: 'Invoice',
  });
  if (mail.ok) throw new Error('demo email was sent');
  if (!(mail.error || '').includes('public demo does not send email')) {
    throw new Error(mail.error || 'missing email block');
  }
  const created = await demoSessionService.create({ ttlMs: 60_000 });
  const expired = await demoSessionService.expire(created.session.id);
  if (expired.status !== 'expired') throw new Error('expire did not set expired');
  const app = await createApp();
  const http = await import('http');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    const platform = await fetch(`http://127.0.0.1:${port}/api/v1/platform/companies`);
    const payload = (await platform.json()) as { error?: { code?: string } };
    if (platform.status !== 403 || payload.error?.code !== 'DEMO_PLATFORM_FORBIDDEN') {
      throw new Error('platform not blocked: ' + platform.status + ' ' + JSON.stringify(payload));
    }
    const register = await fetch(`http://127.0.0.1:${port}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Demo',
        lastName: 'Visitor',
        email: 'visitor@example.test',
        password: 'not-used-in-demo-1',
      }),
    });
    const registerBody = (await register.json()) as { error?: { code?: string } };
    if (register.status !== 403 || registerBody.error?.code !== 'DEMO_REGISTER_DISABLED') {
      throw new Error('register not blocked: ' + register.status + ' ' + JSON.stringify(registerBody));
    }
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const healthBody = (await health.json()) as { data?: { mode?: string; database?: { name?: string } } };
    if (healthBody.data?.mode !== 'demo') throw new Error('health mode ' + healthBody.data?.mode);
    if (healthBody.data?.database?.name !== 'advisortrack_demo') {
      throw new Error('health db ' + healthBody.data?.database?.name);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await closeDatabase();
  }
  console.log('DEMO_HTTP_OK');
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
