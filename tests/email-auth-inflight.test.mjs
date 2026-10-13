import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailAuth } from '../server/email-auth.js';

const origin = 'https://house.example';
const project = 'https://fixture.supabase.test';
const members = { yiting: 'member-a@example.test', haomiao: 'member-b@example.test' };
const user = { id: '11111111-1111-4111-8111-111111111111', email: members.yiting, email_confirmed_at: '2026-01-01T00:00:00Z' };
const config = { SUPABASE_URL: project, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', MEMBER_EMAILS: JSON.stringify(members) };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function cookieFor(label = 'one') {
  const now = Math.floor(Date.now() / 1000);
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', exp: now + 3600, iat: now, session_id: label })}.fixture-signature`;
  // The serialized cookie user is deliberately forged. Only Auth's response may identify us.
  const session = { access_token: token, refresh_token: `fixture-${label}`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: { ...user, id: '22222222-2222-4222-8222-222222222222', email: members.haomiao } };
  return `__Host-house-auth=base64-${encode(session)}`;
}
const authFor = (cookie, env = config) => createEmailAuth(new Request(`${origin}/api/media/fixture`, { headers: cookie ? { Cookie: cookie } : {} }), env);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } });
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(check(), 'Expected mock Auth requests to start');
}

test('simultaneous checks share one Auth request, trust its user, and never retain its result', async () => {
  const originalFetch = globalThis.fetch, waiting = gate();
  let calls = 0, active = true;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${project}/auth/v1/user`, 'Only the mock Auth server is allowed');
    assert.match(new Headers(options.headers).get('authorization'), /^Bearer /);
    calls++;
    if (calls === 1) await waiting.promise;
    return active ? json(user) : json({ msg: 'Session has expired', code: 'session_not_found' }, 401);
  };
  try {
    const cookie = cookieFor();
    const checks = Array.from({ length: 12 }, () => authFor(cookie).resolveIdentity());
    await until(() => calls > 0);
    assert.equal(calls, 1);
    waiting.release();
    const identities = await Promise.all(checks);
    assert.ok(identities.every(identity => identity.authenticated && identity.userId === `supabase:${user.id}` && identity.verifiedEmail === members.yiting));
    active = false;
    assert.deepEqual(await authFor(cookie).resolveIdentity(), { authenticated: false, authorized: false });
    assert.equal(calls, 2, 'Revocation must be checked again after the shared request completes');
    assert.deepEqual(await authFor('').resolveIdentity(), { authenticated: false, authorized: false });
    assert.equal(calls, 2, 'Anonymous requests do not call Auth');
  } finally { waiting.release(); globalThis.fetch = originalFetch; }
});

test('different access tokens, projects and publishable keys remain isolated', async () => {
  const originalFetch = globalThis.fetch, waiting = gate();
  let calls = 0;
  globalThis.fetch = async url => {
    assert.ok([`${project}/auth/v1/user`, 'https://other.supabase.test/auth/v1/user'].includes(url));
    calls++;
    await waiting.promise;
    return json(user);
  };
  try {
    const cookie = cookieFor();
    const checks = [
      authFor(cookie).resolveIdentity(),
      authFor(cookieFor('two')).resolveIdentity(),
      authFor(cookie, { ...config, SUPABASE_URL: 'https://other.supabase.test' }).resolveIdentity(),
      authFor(cookie, { ...config, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_other' }).resolveIdentity()
    ];
    await until(() => calls === 4);
    waiting.release();
    assert.ok((await Promise.all(checks)).every(identity => identity.authenticated));
  } finally { waiting.release(); globalThis.fetch = originalFetch; }
});

test('provider failures are shared only while pending and recovered checks still contact Auth', async () => {
  const originalFetch = globalThis.fetch, waiting = gate();
  let calls = 0, outage = true;
  globalThis.fetch = async url => {
    assert.equal(url, `${project}/auth/v1/user`);
    calls++;
    if (calls === 1) await waiting.promise;
    return outage ? json({ msg: 'Provider unavailable' }, 503) : json(user);
  };
  try {
    const cookie = cookieFor();
    const checks = [authFor(cookie).resolveIdentity(), authFor(cookie).resolveIdentity()];
    const finished = Promise.allSettled(checks);
    await until(() => calls === 1);
    waiting.release();
    assert.ok((await finished).every(result => result.status === 'rejected' && result.reason.status === 503));
    assert.equal(calls, 1);
    outage = false;
    assert.equal((await authFor(cookie).resolveIdentity()).authenticated, true);
    assert.equal(calls, 2);
  } finally { waiting.release(); globalThis.fetch = originalFetch; }
});

test('only successful private preview responses can preserve mandatory browser revalidation', () => {
  const cache = 'private, no-cache, must-revalidate';
  const cases = [
    ['/api/media/image?variant=thumb', 'GET', 200, cache, cache],
    ['/api/media/image?variant=display', 'GET', 304, cache, cache],
    ['/api/media/image?variant=thumb', 'HEAD', 200, cache, cache],
    ['/api/media/image?variant=display', 'GET', 206, cache, 'private, no-store'],
    ['/api/media/image?variant=thumb', 'GET', 401, cache, 'private, no-store'],
    ['/api/media/image?variant=display', 'GET', 404, cache, 'private, no-store'],
    ['/api/media/image?variant=thumb', 'GET', 503, cache, 'private, no-store'],
    ['/api/media/image?variant=thumb', 'POST', 200, cache, 'private, no-store'],
    ['/api/media/image', 'GET', 200, cache, 'private, no-store'],
    ['/api/media/image?variant=original', 'GET', 200, cache, 'private, no-store'],
    ['/api/media/image?variant=thumb&variant=display', 'GET', 200, cache, 'private, no-store'],
    ['/api/media/image/preview/thumb', 'GET', 200, cache, 'private, no-store'],
    ['/api/session?variant=thumb', 'GET', 200, cache, 'private, no-store'],
    ['/api/media/image?variant=thumb', 'GET', 200, 'public, max-age=3600', 'private, no-store']
  ];
  for (const [path, method, status, upstreamCache, expected] of cases) {
    const auth = createEmailAuth(new Request(origin + path, { method }), {});
    const response = auth.decorateResponse(new Response(status === 304 ? null : 'fixture', { status, headers: { 'Cache-Control': upstreamCache, Vary: 'Cookie', ETag: '"fixture"' } }));
    assert.equal(response.headers.get('Cache-Control'), expected, `${method} ${path} ${status}`);
    assert.equal(response.headers.get('Vary'), 'Cookie');
    assert.equal(response.headers.get('ETag'), '"fixture"');
  }
});

test('responses that change session cookies keep no-store even on private preview paths', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, `${project}/auth/v1/logout?scope=local`);
    return new Response(null, { status: 204 });
  };
  try {
    const auth = createEmailAuth(new Request(`${origin}/api/media/image?variant=thumb`, { headers: { Cookie: cookieFor() } }), config);
    await auth.signOut();
    const response = auth.decorateResponse(new Response('fixture', { headers: { 'Cache-Control': 'private, no-cache, must-revalidate', Vary: 'Cookie' } }));
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Vary'), 'Cookie');
    assert.ok(response.headers.getSetCookie().some(value => /Max-Age=0/i.test(value)));
    assert.ok(response.headers.getSetCookie().every(value => /HttpOnly/i.test(value) && /Secure/i.test(value)));
  } finally { globalThis.fetch = originalFetch; }
});
