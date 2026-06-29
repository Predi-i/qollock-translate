import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  clearStateCookie,
  createSession,
  exchangeCodeForIdentity,
  isLoginAllowed,
  readStateCookie,
  sessionCookie,
} from '../../lib/auth';

// GitHub redirects back here with `code` and `state`. Verify the state matches
// the cookie we set in /auth/login, swap the code for an identity, enforce the
// optional allowlist, then create a session and drop the user on the app.
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const fail = (reason: string) =>
    new Response(null, {
      status: 302,
      headers: {
        Location: `/login?error=${encodeURIComponent(reason)}`,
        'Set-Cookie': clearStateCookie(secure),
      },
    });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readStateCookie(request);

  if (!code || !state) return fail('missing code');
  if (!expectedState || state !== expectedState) return fail('state mismatch, please try again');

  const redirectUri = `${url.origin}/auth/callback`;
  const identity = await exchangeCodeForIdentity(env, code, redirectUri);
  if (!identity) return fail('github sign-in failed');

  if (!isLoginAllowed(env, identity.login)) {
    return fail(`@${identity.login} is not on the translator allowlist`);
  }

  const sid = await createSession(env.SESSION, identity);

  // Two Set-Cookie headers: install the session, expire the state cookie.
  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', sessionCookie(sid, secure));
  headers.append('Set-Cookie', clearStateCookie(secure));
  return new Response(null, { status: 302, headers });
};
