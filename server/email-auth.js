import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';

const COOKIE_NAME = '__Host-house-auth';
const slots = ['yiting', 'haomiao'];
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
const anonymous = () => ({ authenticated: false, authorized: false });
const pendingUserChecks = new Map();
const MAX_PENDING_USER_CHECKS = 64;

async function authFetch(config, input, options = {}) {
  const send = () => fetch(input, { ...options, signal: AbortSignal.timeout(10000) });
  const url = typeof input === 'string' ? input : input?.url;
  const headers = new Headers(options.headers);
  const authorization = headers.get('authorization');
  // Merge only simultaneous checks of the exact same token and Auth configuration.
  // This is never a session cache: a later request must contact Auth again.
  if (url !== `${config.url}/auth/v1/user` || (options.method || 'GET') !== 'GET'
    || !authorization?.startsWith('Bearer ') || authorization.length > 8192 || options.body != null) return send();
  const key = JSON.stringify([url, Array.from(headers).sort(([a], [b]) => a.localeCompare(b))]);
  let checking = pendingUserChecks.get(key);
  if (!checking) {
    if (pendingUserChecks.size >= MAX_PENDING_USER_CHECKS) return send();
    checking = Promise.resolve().then(async () => {
      try {
        const response = await send();
        // Never share a fetch Response or its stream between Worker requests.
        // Only immutable, fully read data crosses the in-flight boundary.
        const body = await response.text();
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete('content-length');
        responseHeaders.delete('content-encoding');
        return { body, status: response.status, statusText: response.statusText, headers: Array.from(responseHeaders) };
      } finally { pendingUserChecks.delete(key); }
    });
    pendingUserChecks.set(key, checking);
  }
  const response = await checking;
  return new Response([204, 205, 304].includes(response.status) ? null : response.body, response);
}

function configuration(env) {
  try {
    const url = new URL(env.SUPABASE_URL);
    const members = JSON.parse(env.MEMBER_EMAILS || '{}');
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !key || key.startsWith('sb_secret_')) return null;
    if (Object.keys(members).length !== 2 || Object.keys(members).some(slot => !slots.includes(slot))) return null;
    const emails = slots.map(slot => normalize(members[slot]));
    if (!emails.every(validEmail) || emails[0] === emails[1]) return null;
    return { url: url.href.replace(/\/$/, ''), key, emails };
  } catch { return null; }
}

function providerFailure(error, invalidMessage) {
  if (!error) return;
  if (error.status === 429) fail('验证码请求较频繁，请稍后再试', 429);
  if (!error.status || error.status >= 500 || error.name === 'AuthRetryableFetchError') fail('邮箱服务暂时连接不上，请稍后重试', 503);
  fail(invalidMessage, 400);
}

export function createEmailAuth(request, env) {
  const config = configuration(env);
  const cookies = new Map(parseCookieHeader(request.headers.get('cookie') || '').map(cookie => [cookie.name, cookie.value]));
  const pending = new Map();
  const client = config && createServerClient(config.url, config.key, {
    cookieOptions: { name: COOKIE_NAME, httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => authFetch(config, url, options) },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll: values => {
        for (const cookie of values) {
          pending.set(cookie.name, cookie);
          if (cookie.value) cookies.set(cookie.name, cookie.value);
          else cookies.delete(cookie.name);
        }
      }
    }
  });
  const requireReady = () => { if (!config) fail('邮箱登录暂未连接，请稍后再试', 503); };
  const permittedEmail = value => {
    requireReady();
    const email = normalize(value);
    if (!config.emails.includes(email)) fail('这个邮箱暂时没有小屋的钥匙', 403);
    return email;
  };
  const verifiedUser = user => {
    if (!user || !user.email_confirmed_at || typeof user.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user.id)) return anonymous();
    return { authenticated: true, userId: `supabase:${user.id}`, verifiedEmail: normalize(user.email) };
  };

  return {
    ready: !!config,
    async requestCode(value) {
      const email = permittedEmail(value);
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      providerFailure(error, '验证码暂时无法发送，请检查账号邀请与邮件服务');
    },
    async verifyCode(value, code) {
      const email = permittedEmail(value);
      if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) fail('请填写六位验证码', 400);
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      providerFailure(error, '验证码不正确或已过期，请重新获取');
      // Only the Auth server's fresh user record is trusted, never the cookie's user object.
      const { data, error: userError } = await client.auth.getUser();
      providerFailure(userError, '登录未确认，请重新获取验证码');
      const verified = verifiedUser(data.user);
      if (!verified.authenticated || verified.verifiedEmail !== email) {
        await client.auth.signOut({ scope: 'local' });
        fail('登录账号未确认，请重新获取验证码', 403);
      }
      return verified;
    },
    async resolveIdentity() {
      if (!config || !Array.from(cookies.keys()).some(name => name === COOKIE_NAME || name.startsWith(`${COOKIE_NAME}.`))) return anonymous();
      const { data, error } = await client.auth.getUser();
      if (error) {
        if (!error.status || error.status >= 500 || error.name === 'AuthRetryableFetchError') providerFailure(error, '请重新登录');
        return anonymous();
      }
      return verifiedUser(data.user);
    },
    async signOut() {
      requireReady();
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error && error.name !== 'AuthSessionMissingError') providerFailure(error, '退出登录未完成，请重试');
      for (const name of cookies.keys()) if (name === COOKIE_NAME || name.startsWith(`${COOKIE_NAME}.`)) pending.set(name, { name, value: '', options: { maxAge: 0 } });
    },
    decorateResponse(response) {
      const headers = new Headers(response.headers);
      for (const cookie of pending.values()) headers.append('Set-Cookie', serializeCookieHeader(cookie.name, cookie.value, { ...cookie.options, httpOnly: true, secure: true, sameSite: 'lax', path: '/' }));
      const url = new URL(request.url);
      const variants = url.searchParams.getAll('variant');
      const revalidatePreview = pending.size === 0 && ['GET', 'HEAD'].includes(request.method)
        && /^\/api\/media\/[^/]+$/.test(url.pathname) && variants.length === 1
        && ['thumb', 'display'].includes(variants[0]) && [200, 304].includes(response.status)
        && headers.get('Cache-Control') === 'private, no-cache, must-revalidate';
      if (!revalidatePreview) headers.set('Cache-Control', 'private, no-store');
      headers.set('Pragma', 'no-cache');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
  };
}
