import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { authorizeUrl, stateCookie } from '../../lib/auth';

// Kicks off GitHub OAuth: mint a random state, stash it in a short-lived cookie
// (checked in the callback to defend against CSRF), and bounce to GitHub.
export const GET: APIRoute = async ({ request }) => {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) {
    return new Response('GitHub OAuth is not configured', { status: 500 });
  }
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const redirectUri = `${url.origin}/auth/callback`;
  const state = crypto.randomUUID();

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl(env, redirectUri, state),
      'Set-Cookie': stateCookie(state, secure),
    },
  });
};
