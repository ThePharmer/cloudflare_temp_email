import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import http from 'node:http';
import { WORKER_URL, hashPassword } from '../../fixtures/test-helpers';

type UserInfo = Record<string, unknown>;

async function startOauthServer(userInfo: UserInfo): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'token', token_type: 'Bearer' }));
      return;
    }
    if (req.url === '/userinfo') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(userInfo));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to resolve OAuth test server port');
  const hostname = process.env.CI ? 'e2e-runner' : 'localhost';
  return { server, baseUrl: `http://${hostname}:${addr.port}` };
}

async function saveProvider(
  request: APIRequestContext,
  baseUrl: string,
  extra: Record<string, unknown>,
) {
  const res = await request.post(`${WORKER_URL}/admin/user_oauth2_settings`, {
    data: [{
      name: 'invite-oauth',
      clientID: 'invite-client',
      clientSecret: 'invite-secret',
      authorizationURL: `${baseUrl}/authorize`,
      accessTokenURL: `${baseUrl}/token`,
      accessTokenFormat: 'json',
      userInfoURL: `${baseUrl}/userinfo`,
      redirectURL: `${baseUrl}/callback`,
      userEmailKey: 'email',
      scope: 'openid email',
      ...extra,
    }],
  });
  expect(res.ok()).toBe(true);
}

async function oauthCallback(request: APIRequestContext) {
  return request.post(`${WORKER_URL}/user_api/oauth2/callback`, {
    data: { clientID: 'invite-client', code: 'invite-code' },
    headers: { 'x-lang': 'en' },
  });
}

function jwtPayload(jwt: string): { user_email: string; user_id: number } {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

async function withProvider(
  request: APIRequestContext,
  userInfo: UserInfo,
  extra: Record<string, unknown>,
  fn: () => Promise<void>,
) {
  const { server, baseUrl } = await startOauthServer(userInfo);
  try {
    await saveProvider(request, baseUrl, extra);
    await fn();
  } finally {
    server.close();
  }
}

const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@invite.example.com`;

test.describe('OAuth2 invite-only and email_verified', () => {
  test.afterEach(async ({ request }) => {
    const res = await request.post(`${WORKER_URL}/admin/user_oauth2_settings`, { data: [] });
    expect(res.ok()).toBe(true);
  });

  test('providers without the new fields keep auto-registering unknown users', async ({ request }) => {
    const email = uniqueEmail('legacy');
    await withProvider(request, { email, email_verified: false }, {}, async () => {
      const res = await oauthCallback(request);
      expect(res.status()).toBe(200);
      expect(jwtPayload((await res.json()).jwt).user_email).toBe(email);
    });
  });

  test('invite-only rejects users the admin has not created', async ({ request }) => {
    const email = uniqueEmail('stranger');
    await withProvider(request, { email }, { enableAutoRegister: false }, async () => {
      const res = await oauthCallback(request);
      expect(res.status()).toBe(403);
    });

    const users = await request.get(`${WORKER_URL}/admin/users`, {
      params: { limit: '20', offset: '0', query: email },
    });
    expect(users.ok()).toBe(true);
    expect((await users.json()).results).toHaveLength(0);
  });

  test('invite-only lets an admin-created user in, matching email case-insensitively', async ({ request }) => {
    const email = uniqueEmail('invited');
    const storedEmail = email.replace(/^invited/, 'Invited');
    const create = await request.post(`${WORKER_URL}/admin/users`, { data: { email: storedEmail } });
    expect(create.ok()).toBe(true);

    await withProvider(request, { email }, { enableAutoRegister: false }, async () => {
      const res = await oauthCallback(request);
      expect(res.status()).toBe(200);
      expect(jwtPayload((await res.json()).jwt).user_email).toBe(storedEmail);
    });

    const users = await request.get(`${WORKER_URL}/admin/users`, {
      params: { limit: '20', offset: '0', query: email.split('@')[0].slice('invited'.length) },
    });
    expect(users.ok()).toBe(true);
    expect((await users.json()).results).toHaveLength(1);
  });

  test('invite-only prefers an exact email match over a case variant', async ({ request }) => {
    const email = uniqueEmail('exact');
    const variant = email.replace(/^exact/, 'Exact');
    // the case variant is created first, so it has the lower id
    for (const e of [variant, email]) {
      const create = await request.post(`${WORKER_URL}/admin/users`, { data: { email: e } });
      expect(create.ok()).toBe(true);
    }

    await withProvider(request, { email }, { enableAutoRegister: false }, async () => {
      const res = await oauthCallback(request);
      expect(res.status()).toBe(200);
      expect(jwtPayload((await res.json()).jwt).user_email).toBe(email);
    });
  });

  test('auto-register keeps exact-match behavior and ignores case variants', async ({ request }) => {
    const email = uniqueEmail('autocase');
    const variant = email.replace(/^autocase/, 'Autocase');
    const create = await request.post(`${WORKER_URL}/admin/users`, { data: { email: variant } });
    expect(create.ok()).toBe(true);

    await withProvider(request, { email }, {}, async () => {
      const res = await oauthCallback(request);
      expect(res.status()).toBe(200);
      expect(jwtPayload((await res.json()).jwt).user_email).toBe(email);
    });
  });

  test('admin-created users without a password cannot use password login', async ({ request }) => {
    const email = uniqueEmail('nopass');
    const create = await request.post(`${WORKER_URL}/admin/users`, { data: { email } });
    expect(create.ok()).toBe(true);

    for (const password of ['', hashPassword(''), hashPassword('guess')]) {
      const login = await request.post(`${WORKER_URL}/user_api/login`, { data: { email, password } });
      expect(login.ok()).toBe(false);
    }

    await withProvider(request, { email }, { enableAutoRegister: false }, async () => {
      const res = await oauthCallback(request);
      expect(res.status()).toBe(200);
    });
  });

  for (const key of ['enableAutoRegister', 'requireEmailVerified']) {
    test(`saving a non-boolean ${key} is rejected`, async ({ request }) => {
      const res = await request.post(`${WORKER_URL}/admin/user_oauth2_settings`, {
        data: [{
          name: 'bad-type',
          clientID: 'bad-client',
          clientSecret: 'bad-secret',
          authorizationURL: 'https://idp.example.com/authorize',
          accessTokenURL: 'https://idp.example.com/token',
          accessTokenFormat: 'json',
          userInfoURL: 'https://idp.example.com/userinfo',
          redirectURL: 'https://idp.example.com/callback',
          userEmailKey: 'email',
          scope: 'openid email',
          [key]: 'false',
        }],
      });
      expect(res.status()).toBe(400);
    });
  }

  for (const [label, claim] of [
    ['false', { email_verified: false }],
    ['missing', {}],
    ['string "false"', { email_verified: 'false' }],
  ] as const) {
    test(`requireEmailVerified rejects email_verified ${label}`, async ({ request }) => {
      const email = uniqueEmail('unverified');
      await withProvider(request, { email, ...claim }, { requireEmailVerified: true }, async () => {
        const res = await oauthCallback(request);
        expect(res.status()).toBe(403);
      });
    });
  }

  for (const [label, value] of [['true', true], ['string "true"', 'true']] as const) {
    test(`requireEmailVerified accepts email_verified ${label}`, async ({ request }) => {
      const email = uniqueEmail('verified');
      await withProvider(request, { email, email_verified: value }, { requireEmailVerified: true }, async () => {
        const res = await oauthCallback(request);
        expect(res.status()).toBe(200);
      });
    });
  }

  test('email_verified is checked before the invite gate', async ({ request }) => {
    const email = uniqueEmail('invited-unverified');
    const create = await request.post(`${WORKER_URL}/admin/users`, {
      data: { email, password: hashPassword('invite-pass') },
    });
    expect(create.ok()).toBe(true);

    await withProvider(
      request,
      { email, email_verified: false },
      { enableAutoRegister: false, requireEmailVerified: true },
      async () => {
        const res = await oauthCallback(request);
        expect(res.status()).toBe(403);
        expect(await res.text()).toMatch(/not verified/i);
      },
    );
  });
});
