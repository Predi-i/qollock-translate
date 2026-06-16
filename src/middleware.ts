import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { verifyAccessJwt } from './lib/access';

export const onRequest = defineMiddleware(async (ctx, next) => {
  const url = new URL(ctx.request.url);
  if (url.pathname.startsWith('/api/live/')) {
    return next();
  }

  if (import.meta.env.DEV) {
    ctx.locals.translatorEmail = env.TRANSLATOR_EMAIL || 'local-dev@grimoire';
    return next();
  }

  const result = await verifyAccessJwt(ctx.request, env);
  if ('error' in result) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  ctx.locals.translatorEmail = result.email;
  return next();
});
