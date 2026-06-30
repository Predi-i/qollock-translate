import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getSession, isReviewer } from './lib/auth';

// Auth gate. Translators sign in with GitHub (see src/lib/auth.ts); the session
// lives in KV and is keyed by the `ql_session` cookie. Unauthenticated page
// loads are redirected to /login; unauthenticated API calls get a 401 JSON so
// the client can surface the error without a redirect dance.
export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = new URL(ctx.request.url);
  const path = url.pathname;

  // Public surfaces: the in-client suggestion API, the OAuth dance, the login
  // page, and static assets must all be reachable without a session.
  if (
    path.startsWith('/api/live/') ||
    path.startsWith('/auth/') ||
    path === '/login' ||
    path.startsWith('/_')
  ) {
    return next();
  }

  // Local dev: skip OAuth entirely and run as a fixed identity. Treat the dev
  // user as a reviewer so the approve flow can be exercised without a session.
  if (import.meta.env.DEV) {
    ctx.locals.translatorEmail = env.TRANSLATOR_EMAIL || 'local-dev@qollock';
    ctx.locals.translatorLogin = 'local-dev';
    ctx.locals.isReviewer = true;
    return next();
  }

  const session = await getSession(env.SESSION, ctx.request);
  if (!session) {
    if (path.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not signed in' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, { status: 302, headers: { Location: '/login' } });
  }

  ctx.locals.translatorEmail = session.email;
  ctx.locals.translatorLogin = session.login;
  ctx.locals.isReviewer = isReviewer(env, session.login);
  return next();
});
