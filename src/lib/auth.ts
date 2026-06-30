// GitHub OAuth + KV-backed session handling for translator sign-in.
//
// This replaces the upstream Cloudflare Access integration (src/lib/access.ts):
// Access gates the app behind a Cloudflare Zero Trust policy, which requires a
// payment card on file even on the free plan. GitHub OAuth needs no card and
// doubles as identity (the translator's GitHub login/email is the attribution
// used throughout the DB).
//
// Flow:
//   /auth/login    -> redirect to GitHub authorize, set a signed `oauth_state` cookie
//   /auth/callback -> verify state, exchange code for a token, fetch the profile,
//                     create a KV session, set the `ql_session` cookie
//   /auth/logout   -> delete the KV session, clear the cookie
// The middleware reads the session on every request and exposes the identity as
// `ctx.locals.translatorEmail`.

const SESSION_COOKIE = 'ql_session';
const STATE_COOKIE = 'oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const STATE_TTL_SECONDS = 60 * 10; // 10 minutes for the round trip
const SESSION_PREFIX = 'sess:';

export interface SessionIdentity {
  // GitHub login (e.g. "octocat"). Stable handle, used as the gate key.
  login: string;
  // Email or `<login>@users.noreply.github.com` fallback. This is the value
  // written to the DB as the translator/reviewer identity.
  email: string;
  avatarUrl: string | null;
}

interface OAuthEnv {
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  ALLOWED_GITHUB_USERS?: string;
  REVIEWER_GITHUB_USERS?: string;
}

// ── Cookies ───────────────────────────────────────────────────────────────

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge?: number; secure?: boolean } = {}
): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure !== false) parts.push('Secure');
  if (typeof opts.maxAge === 'number') parts.push(`Max-Age=${opts.maxAge}`);
  return parts.join('; ');
}

export function sessionCookie(sid: string, secure = true): string {
  return serializeCookie(SESSION_COOKIE, sid, { maxAge: SESSION_TTL_SECONDS, secure });
}

export function clearSessionCookie(secure = true): string {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure });
}

export function stateCookie(state: string, secure = true): string {
  return serializeCookie(STATE_COOKIE, state, { maxAge: STATE_TTL_SECONDS, secure });
}

export function clearStateCookie(secure = true): string {
  return serializeCookie(STATE_COOKIE, '', { maxAge: 0, secure });
}

export function readStateCookie(request: Request): string | null {
  return cookieValue(request.headers.get('Cookie'), STATE_COOKIE);
}

// ── Session store (KV) ──────────────────────────────────────────────────────

// crypto.randomUUID is available in the Workers runtime. We avoid Math.random.
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export async function createSession(kv: KVNamespace, identity: SessionIdentity): Promise<string> {
  const sid = newId();
  await kv.put(SESSION_PREFIX + sid, JSON.stringify(identity), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return sid;
}

export async function getSession(
  kv: KVNamespace,
  request: Request
): Promise<SessionIdentity | null> {
  const sid = cookieValue(request.headers.get('Cookie'), SESSION_COOKIE);
  if (!sid) return null;
  const raw = await kv.get(SESSION_PREFIX + sid);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionIdentity;
  } catch {
    return null;
  }
}

export async function destroySession(kv: KVNamespace, request: Request): Promise<void> {
  const sid = cookieValue(request.headers.get('Cookie'), SESSION_COOKIE);
  if (sid) await kv.delete(SESSION_PREFIX + sid);
}

// ── GitHub OAuth ────────────────────────────────────────────────────────────

export function authorizeUrl(env: OAuthEnv, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read:user user:email',
    state,
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

// Exchange the OAuth `code` for an access token, then fetch the user's profile.
// Returns null on any failure (bad code, network, GitHub error) so callers can
// redirect back to the login page without leaking detail.
export async function exchangeCodeForIdentity(
  env: OAuthEnv,
  code: string,
  redirectUri: string
): Promise<SessionIdentity | null> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return null;
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  const token = tokenData.access_token;
  if (!token) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'qollock-translate',
  };

  const userRes = await fetch('https://api.github.com/user', { headers });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as {
    login?: string;
    email?: string | null;
    avatar_url?: string | null;
  };
  if (!user.login) return null;

  // The public profile email is often null; ask the emails endpoint for the
  // primary verified address, falling back to GitHub's noreply form.
  let email = user.email ?? '';
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (primary) email = primary.email;
    }
  }
  if (!email) email = `${user.login}@users.noreply.github.com`;

  return { login: user.login, email, avatarUrl: user.avatar_url ?? null };
}

// Optional allowlist: when ALLOWED_GITHUB_USERS is set, only those logins may
// sign in. Empty/unset means open to any GitHub account.
export function isLoginAllowed(env: OAuthEnv, login: string): boolean {
  const raw = (env.ALLOWED_GITHUB_USERS ?? '').trim();
  if (!raw) return true;
  return parseLoginList(raw).includes(login.toLowerCase());
}

// Reviewers are named in REVIEWER_GITHUB_USERS (comma/space list of GitHub
// logins). A reviewer's edits land approved and they can approve others' work;
// everyone else's edits go to "needs review". Empty/unset means no reviewers,
// so set it for the people who should be able to approve.
export function isReviewer(env: OAuthEnv, login: string): boolean {
  const raw = (env.REVIEWER_GITHUB_USERS ?? '').trim();
  if (!raw) return false;
  return parseLoginList(raw).includes(login.toLowerCase());
}

function parseLoginList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
