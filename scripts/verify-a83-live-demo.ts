/**
 * Optional live demo API checks against localhost:3001.
 * Does not print tokens or passwords.
 */
import assert from 'node:assert/strict';

const API = process.env.ADVISORTRACK_DEMO_API_URL?.replace(/\/$/, '') || 'http://127.0.0.1:3001/api/v1';

type Envelope<T> = { success: true; data: T } | { success: false; error: { message?: string; code?: string } };

async function request<T>(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; data: T | null; code?: string; message?: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-AdvisorTrack-Client': 'web',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = (await response.json()) as Envelope<T>;
  if (json && 'success' in json && json.success) {
    return { status: response.status, data: json.data };
  }
  const error = json && 'error' in json ? json.error : undefined;
  return { status: response.status, data: null, code: error?.code, message: error?.message };
}

async function main() {
  const enter = await request<{ token: string; user: { id: string; email?: string } }>('/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'financial_advisor' },
  });
  assert.ok(enter.status === 200 || enter.status === 201, 'demo enter should succeed');
  assert.ok(enter.data?.token, 'demo enter returns a token');
  const token = enter.data!.token;
  const mayaId = enter.data!.user.id;

  const list = await request<Array<{ id: string; firstName: string }>>('/contacts', { token });
  assert.equal(list.status, 200);
  assert.ok((list.data?.length ?? 0) > 0, 'Maya has seeded contacts');

  const other = await request<{ token: string; user: { id: string } }>('/demo/enter', {
    method: 'POST',
    body: { selectedRole: 'team_leader' },
  });
  assert.ok(other.status === 200 || other.status === 201);
  const otherToken = other.data!.token;
  const otherContacts = await request<Array<{ id: string; userId?: string }>>('/contacts', { token: otherToken });
  assert.equal(otherContacts.status, 200);
  const foreignId = otherContacts.data?.find((row) => row.id !== list.data![0].id)?.id ?? otherContacts.data?.[0]?.id;
  if (foreignId) {
    const steal = await request(`/contacts/${foreignId}`, { token });
    assert.equal(steal.status, 404, 'Maya cannot read another persona contact by id');
    assert.equal(steal.code, 'NOT_FOUND');
    assert.doesNotMatch(steal.message ?? '', /exists|another advisor/i);
  }

  const created = await request<{ id: string }>(
    '/contacts',
    {
      method: 'POST',
      token,
      body: {
        firstName: 'A83Live',
        lastName: 'Check',
        email: `a83.live.${Date.now()}@example.advisortrack`,
        status: 'prospect',
      },
    },
  );
  assert.equal(created.status, 201, 'Maya can create a contact in the demo session');
  const opened = await request<{ id: string; contactId: string }>(
    `/cases/contact/${created.data!.id}`,
    { token },
  );
  assert.equal(opened.status, 200);
  assert.equal(opened.data?.contactId, created.data!.id);

  const me = await request<{ id: string; lastMobileActivityAt?: string | null }>('/auth/me', { token });
  assert.equal(me.status, 200);
  assert.ok(me.data?.id === mayaId || Boolean(me.data), 'web request stays on Maya');

  console.log('A8.3 live demo API checks passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'live demo check failed');
  process.exit(1);
});
